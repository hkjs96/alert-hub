import { extractSeverity, isRecord, mapFiringStatus, str } from "@/lib/normalize";
import type { NormalizedAlert } from "@/lib/types";
import type { Provider } from "@/lib/providers/types";
import { normalizeLabelAlert } from "@/lib/providers/shared";

// Grafana has two very different webhook generations:
//  - Unified alerting (Grafana 8+, only option in 10+): Alertmanager-style,
//    `alerts: []` + `orgId`/`version:"1"`/`dashboardURL`. ← PoC target.
//  - Legacy alerting (Grafana <8): flat payload with `evalMatches`, `state`,
//    `ruleName`, no `alerts[]`. ← best-effort.

function isUnified(payload: Record<string, unknown>): boolean {
  return Array.isArray(payload.alerts);
}

function isLegacy(payload: Record<string, unknown>): boolean {
  return "evalMatches" in payload || "ruleName" in payload || "ruleId" in payload;
}

function looksLikeGrafana(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (isLegacy(payload)) return true;
  // Unified: shares Alertmanager shape, so require a Grafana-only marker.
  if (isUnified(payload)) {
    return (
      payload.orgId !== undefined ||
      payload.version === "1" ||
      (Array.isArray(payload.alerts) &&
        payload.alerts.some((a) => isRecord(a) && "dashboardURL" in a))
    );
  }
  return false;
}

function normalizeLegacy(payload: Record<string, unknown>): NormalizedAlert | null {
  const ruleName = str(payload.ruleName) ?? str(payload.title);
  if (!ruleName) return null;
  const ruleId = str(payload.ruleId) ?? ruleName;
  const message = str(payload.message);
  const tags = isRecord(payload.tags) ? payload.tags : {};
  const severity = str(tags.severity)?.toUpperCase() ?? extractSeverity(ruleName, message);

  return {
    fingerprint: `grafana:${ruleId}`,
    title: ruleName,
    description: message,
    source: "grafana",
    severity,
    // Legacy `state`: alerting | ok | no_data | paused.
    status: mapFiringStatus(str(payload.state)),
    stateReason: message,
    raw: payload,
  };
}

export const grafanaProvider: Provider = {
  name: "grafana",
  detect: looksLikeGrafana,
  normalize(payload) {
    if (!isRecord(payload)) return [];

    if (isUnified(payload)) {
      const out: NormalizedAlert[] = [];
      for (const raw of payload.alerts as unknown[]) {
        if (!isRecord(raw)) continue;
        const alert = normalizeLabelAlert("grafana", raw);
        if (alert) out.push(alert);
      }
      return out;
    }

    if (isLegacy(payload)) {
      const alert = normalizeLegacy(payload);
      return alert ? [alert] : [];
    }

    return [];
  },
};
