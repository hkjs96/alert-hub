import { extractSeverity, isRecord, mapCloudWatchState, str } from "@/lib/normalize";
import type { NormalizedAlert } from "@/lib/types";
import type { Provider } from "@/lib/providers/types";

/** A payload is a CloudWatch alarm if it carries the tell-tale top-level keys. */
export function isCloudWatchAlarm(payload: unknown): boolean {
  return (
    isRecord(payload) &&
    typeof payload.AlarmName === "string" &&
    "NewStateValue" in payload
  );
}

function normalizeCloudWatch(payload: Record<string, unknown>): NormalizedAlert {
  const alarmName = String(payload.AlarmName ?? "");
  const description = str(payload.AlarmDescription);
  const alarmArn = str(payload.AlarmArn);
  const stateReason = str(payload.NewStateReason);

  // accountId = 5th ":"-delimited segment of the alarm ARN.
  // region     = 4th segment. Fall back to explicit fields where present.
  let accountId: string | undefined;
  let region: string | undefined;
  if (alarmArn) {
    const segments = alarmArn.split(":");
    region = segments[3] || undefined;
    accountId = segments[4] || undefined;
  }
  accountId ??= str(payload.AWSAccountId);
  region ??= str(payload.Region);

  const trigger = isRecord(payload.Trigger) ? payload.Trigger : undefined;
  const metric = trigger ? str(trigger.MetricName) : undefined;
  const namespace = trigger ? str(trigger.Namespace) : undefined;
  const threshold =
    trigger && typeof trigger.Threshold === "number" ? trigger.Threshold : undefined;
  const comparison = trigger ? str(trigger.ComparisonOperator) : undefined;

  // Build a human-readable resource from the trigger dimensions when present.
  let resource: string | undefined;
  if (trigger && Array.isArray(trigger.Dimensions)) {
    const parts = trigger.Dimensions.filter(isRecord)
      .map((d) => {
        const name = str(d.name);
        const value = str(d.value);
        return name && value ? `${name}=${value}` : value;
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
    status: mapCloudWatchState(str(payload.NewStateValue)),
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

export const cloudwatchProvider: Provider = {
  name: "cloudwatch",
  detect: isCloudWatchAlarm,
  normalize(payload) {
    if (!isCloudWatchAlarm(payload)) return [];
    const alert = normalizeCloudWatch(payload as Record<string, unknown>);
    return alert.title ? [alert] : [];
  },
};
