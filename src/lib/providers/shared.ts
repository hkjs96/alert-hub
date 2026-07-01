import { extractSeverity, isRecord, mapFiringStatus, str } from "@/lib/normalize";
import type { NormalizedAlert } from "@/lib/types";

/**
 * Normalize a single label/annotation-shaped alert. This is the common shape
 * that Prometheus Alertmanager and Grafana (unified alerting) both use — one
 * entry of the `alerts: []` array — so both providers reuse it.
 *
 * `source` becomes the fingerprint prefix so keys never collide across
 * providers (prometheus:<x> vs grafana:<x>).
 */
export function normalizeLabelAlert(
  source: string,
  alert: Record<string, unknown>,
): NormalizedAlert | null {
  const labels = isRecord(alert.labels) ? alert.labels : {};
  const annotations = isRecord(alert.annotations) ? alert.annotations : {};

  const alertname = str(labels.alertname);
  const summary = str(annotations.summary);
  const description = str(annotations.description);
  const title = alertname ?? summary ?? "alert";
  if (title === "alert" && !alertname && !summary) return null;

  const instance = str(labels.instance);
  const job = str(labels.job);
  const resource = instance ?? job;

  // Alertmanager/Grafana ship a stable per-alert `fingerprint`; prefer it.
  const nativeFingerprint = str(alert.fingerprint);
  const fingerprint = nativeFingerprint
    ? `${source}:${nativeFingerprint}`
    : `${source}:${alertname ?? title}:${resource ?? ""}`;

  const severityLabel = str(labels.severity);
  const severity = severityLabel
    ? severityLabel.toUpperCase()
    : extractSeverity(alertname, description, summary);

  return {
    fingerprint,
    title,
    description: description ?? summary,
    source,
    severity,
    status: mapFiringStatus(str(alert.status)),
    resource,
    metric: str(labels.metric),
    namespace: str(labels.namespace),
    // Grafana includes a rendered value string; Prometheus generally does not.
    value: str(alert.valueString),
    stateReason: description ?? summary,
    raw: alert,
  };
}
