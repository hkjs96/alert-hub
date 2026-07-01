import type { NormalizedAlert } from "@/lib/types";
import type { Provider } from "@/lib/providers/types";
import { cloudwatchProvider } from "@/lib/providers/cloudwatch";
import { prometheusProvider } from "@/lib/providers/prometheus";
import { grafanaProvider } from "@/lib/providers/grafana";
import { pagerdutyProvider } from "@/lib/providers/pagerduty";
import { genericProvider } from "@/lib/providers/generic";

export type { Provider } from "@/lib/providers/types";

// Auto-detect order matters: most specific first, generic last. CloudWatch and
// PagerDuty have unambiguous wrappers; Prometheus vs Grafana is disambiguated
// inside their own detect() via version/orgId markers.
const REGISTRY: Provider[] = [
  cloudwatchProvider,
  pagerdutyProvider,
  grafanaProvider,
  prometheusProvider,
  genericProvider,
];

const BY_NAME = new Map(REGISTRY.map((p) => [p.name, p]));

/** URL segment used for the auto-detect endpoint (/api/webhooks/alarm). */
export const AUTO_DETECT = "alarm";

export function isKnownProvider(name: string): boolean {
  return name === AUTO_DETECT || BY_NAME.has(name);
}

export function providerNames(): string[] {
  return REGISTRY.map((p) => p.name);
}

export interface NormalizeOutcome {
  /** The provider actually used ("generic" if auto-detect fell through). */
  provider: string;
  alerts: NormalizedAlert[];
}

/**
 * Turn an already-parsed payload (SNS envelope peeled off upstream) into
 * normalized alerts.
 *
 * - Explicit `name` (e.g. "grafana"): use that provider directly, no detection.
 * - `name` omitted or "alarm": auto-detect by walking the registry.
 */
export function normalizeWith(
  name: string | undefined,
  payload: unknown,
): NormalizeOutcome {
  if (name && name !== AUTO_DETECT) {
    const provider = BY_NAME.get(name);
    if (!provider) return { provider: name, alerts: [] };
    return { provider: provider.name, alerts: provider.normalize(payload) };
  }

  for (const provider of REGISTRY) {
    if (provider.detect(payload)) {
      return { provider: provider.name, alerts: provider.normalize(payload) };
    }
  }
  return { provider: "generic", alerts: [] };
}
