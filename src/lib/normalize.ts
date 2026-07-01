import type { AlertStatus, NormalizedAlert } from "@/lib/types";

// --- helpers ---------------------------------------------------------------

const VALID_STATUSES: AlertStatus[] = [
  "FIRING",
  "RESOLVED",
  "ACKNOWLEDGED",
  "INSUFFICIENT_DATA",
];

/**
 * Pull a "SEV-n" severity out of free text (alarm name or description).
 * Accepts SEV1 / SEV-1 / sev 1, normalizes to `SEV-<n>`. Falls back to UNKNOWN.
 */
export function extractSeverity(...texts: (string | null | undefined)[]): string {
  for (const text of texts) {
    if (!text) continue;
    const match = text.match(/sev[\s-]?(\d)/i);
    if (match) return `SEV-${match[1]}`;
  }
  return "UNKNOWN";
}

/** Map a CloudWatch state value onto our provider-agnostic status. */
export function mapCloudWatchState(state: string | undefined): AlertStatus {
  switch ((state ?? "").toUpperCase()) {
    case "ALARM":
      return "FIRING";
    case "OK":
      return "RESOLVED";
    case "INSUFFICIENT_DATA":
      return "INSUFFICIENT_DATA";
    default:
      return "FIRING";
  }
}

/** Coerce an arbitrary user-supplied status string onto our enum. */
function coerceStatus(input: string | undefined): AlertStatus {
  const upper = (input ?? "").trim().toUpperCase();
  if ((VALID_STATUSES as string[]).includes(upper)) return upper as AlertStatus;
  switch (upper) {
    case "ALARM":
    case "TRIGGERED":
    case "OPEN":
      return "FIRING";
    case "OK":
    case "CLEARED":
    case "CLOSED":
      return "RESOLVED";
    case "ACK":
    case "ACKED":
      return "ACKNOWLEDGED";
    default:
      return "FIRING";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// --- CloudWatch ------------------------------------------------------------

/** A payload is a CloudWatch alarm if it carries the tell-tale top-level keys. */
export function isCloudWatchAlarm(payload: unknown): boolean {
  return (
    isRecord(payload) &&
    typeof payload.AlarmName === "string" &&
    "NewStateValue" in payload
  );
}

export function normalizeCloudWatch(payload: Record<string, unknown>): NormalizedAlert {
  const alarmName = String(payload.AlarmName ?? "");
  const description =
    typeof payload.AlarmDescription === "string" && payload.AlarmDescription
      ? payload.AlarmDescription
      : undefined;
  const alarmArn =
    typeof payload.AlarmArn === "string" ? payload.AlarmArn : undefined;
  const stateReason =
    typeof payload.NewStateReason === "string"
      ? payload.NewStateReason
      : undefined;

  // accountId = 5th ":"-delimited segment of the alarm ARN.
  // region     = 4th segment. Fall back to the Region field where present.
  let accountId: string | undefined;
  let region: string | undefined;
  if (alarmArn) {
    const segments = alarmArn.split(":");
    region = segments[3] || undefined;
    accountId = segments[4] || undefined;
  }
  if (!accountId && typeof payload.AWSAccountId === "string") {
    accountId = payload.AWSAccountId;
  }
  if (!region && typeof payload.Region === "string") {
    region = payload.Region;
  }

  const trigger = isRecord(payload.Trigger) ? payload.Trigger : undefined;
  const metric =
    trigger && typeof trigger.MetricName === "string"
      ? trigger.MetricName
      : undefined;
  const namespace =
    trigger && typeof trigger.Namespace === "string"
      ? trigger.Namespace
      : undefined;
  const threshold =
    trigger && typeof trigger.Threshold === "number"
      ? trigger.Threshold
      : undefined;
  const comparison =
    trigger && typeof trigger.ComparisonOperator === "string"
      ? trigger.ComparisonOperator
      : undefined;

  // Build a human-readable resource from the trigger dimensions when present.
  let resource: string | undefined;
  if (trigger && Array.isArray(trigger.Dimensions)) {
    const parts = trigger.Dimensions.filter(isRecord)
      .map((d) => {
        const name = typeof d.name === "string" ? d.name : undefined;
        const value = typeof d.value === "string" ? d.value : undefined;
        if (name && value) return `${name}=${value}`;
        return value;
      })
      .filter((v): v is string => Boolean(v));
    if (parts.length) resource = parts.join(",");
  }

  return {
    fingerprint: alarmArn ? `cw:${alarmArn}` : `cw:${alarmName}`,
    title: alarmName,
    description,
    source: "cloudwatch",
    severity: extractSeverity(alarmName, description),
    status: mapCloudWatchState(
      typeof payload.NewStateValue === "string"
        ? payload.NewStateValue
        : undefined,
    ),
    resource,
    metric,
    namespace,
    threshold,
    comparison,
    region,
    accountId,
    stateReason,
    raw: payload,
  };
}

// --- Generic ---------------------------------------------------------------

export function normalizeGeneric(payload: Record<string, unknown>): NormalizedAlert {
  const title = String(payload.title ?? payload.name ?? "").trim();
  const source =
    typeof payload.source === "string" && payload.source
      ? payload.source
      : "generic";
  const resource =
    typeof payload.resource === "string" && payload.resource
      ? payload.resource
      : undefined;
  const description =
    typeof payload.description === "string" && payload.description
      ? payload.description
      : undefined;
  const reason =
    typeof payload.reason === "string" && payload.reason
      ? payload.reason
      : undefined;

  const providedSeverity =
    typeof payload.severity === "string" && payload.severity
      ? payload.severity.toUpperCase()
      : undefined;

  return {
    fingerprint: `${source}:${title}:${resource ?? ""}`,
    title,
    description,
    source,
    severity: providedSeverity ?? extractSeverity(title, description, reason),
    status: coerceStatus(
      typeof payload.status === "string" ? payload.status : undefined,
    ),
    resource,
    metric:
      typeof payload.metric === "string" && payload.metric
        ? payload.metric
        : undefined,
    value:
      payload.value !== undefined && payload.value !== null
        ? String(payload.value)
        : undefined,
    stateReason: reason,
    raw: payload,
  };
}

// --- Dispatch --------------------------------------------------------------

/**
 * Normalize an already-parsed payload (i.e. the SNS envelope has been peeled
 * off upstream). Chooses the CloudWatch shape when it looks like a CloudWatch
 * alarm, otherwise treats it as a generic alert.
 *
 * Returns null when the payload cannot be turned into a meaningful alert
 * (e.g. a generic payload with no title/name).
 */
export function normalizePayload(payload: unknown): NormalizedAlert | null {
  if (!isRecord(payload)) return null;

  if (isCloudWatchAlarm(payload)) {
    const normalized = normalizeCloudWatch(payload);
    return normalized.title ? normalized : null;
  }

  const normalized = normalizeGeneric(payload);
  return normalized.title ? normalized : null;
}
