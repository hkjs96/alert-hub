import type { AlertStatus } from "@/lib/types";

// Shared normalization helpers used by every provider parser. The
// provider-specific logic lives in src/lib/providers/*; this file only holds
// the small pieces they have in common.

const VALID_STATUSES: AlertStatus[] = [
  "FIRING",
  "RESOLVED",
  "ACKNOWLEDGED",
  "INSUFFICIENT_DATA",
];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Return a trimmed string for string-ish values, otherwise undefined. */
export function str(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

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

/**
 * Map the firing/resolved-style status used by Prometheus, Alertmanager, and
 * Grafana onto our enum.
 */
export function mapFiringStatus(input: string | undefined): AlertStatus {
  switch ((input ?? "").toLowerCase()) {
    case "firing":
    case "alerting":
    case "active":
      return "FIRING";
    case "resolved":
    case "ok":
      return "RESOLVED";
    case "no_data":
    case "nodata":
    // Grafana legacy "paused": the rule stopped evaluating — that is an
    // absence of signal, not an active alert.
    case "paused":
      return "INSUFFICIENT_DATA";
    default:
      return "FIRING";
  }
}

/** Coerce an arbitrary user-supplied status string onto our enum. */
export function coerceStatus(input: string | undefined): AlertStatus {
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
