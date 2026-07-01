import { isRecord } from "@/lib/normalize";
import type { NormalizedAlert } from "@/lib/types";
import type { Provider } from "@/lib/providers/types";
import { normalizeLabelAlert } from "@/lib/providers/shared";

/**
 * Prometheus Alertmanager webhook (schema `version: "4"`, stable for years).
 * A single POST carries a batch of alerts in `alerts: []`.
 *
 * We distinguish it from Grafana (which reuses the same shape) by the
 * Alertmanager-only markers `version: "4"` / `groupKey`, and by the ABSENCE of
 * Grafana markers (orgId, dashboardURL). Explicit /api/webhooks/prometheus
 * skips this and parses directly.
 */
function looksLikeAlertmanager(payload: unknown): boolean {
  if (!isRecord(payload) || !Array.isArray(payload.alerts)) return false;
  if (payload.orgId !== undefined) return false; // Grafana marker
  return payload.version === "4" || "groupKey" in payload;
}

export const prometheusProvider: Provider = {
  name: "prometheus",
  detect: looksLikeAlertmanager,
  normalize(payload) {
    if (!isRecord(payload) || !Array.isArray(payload.alerts)) return [];
    const out: NormalizedAlert[] = [];
    for (const raw of payload.alerts) {
      if (!isRecord(raw)) continue;
      const alert = normalizeLabelAlert("prometheus", raw);
      if (alert) out.push(alert);
    }
    return out;
  },
};

