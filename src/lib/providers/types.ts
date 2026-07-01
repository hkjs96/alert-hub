import type { NormalizedAlert } from "@/lib/types";

/**
 * A Provider turns one source's webhook payload into our provider-agnostic
 * `NormalizedAlert[]`. Everything downstream (dedup, storage, notify,
 * dashboard) only ever sees NormalizedAlert, so adding a source is just adding
 * a Provider — nothing else changes.
 *
 * Returning an array is deliberate: Prometheus/Grafana send batches
 * (`alerts: []`) in a single POST, so one request can yield many alerts.
 */
export interface Provider {
  /** Stable id, also the URL segment: /api/webhooks/<name>. */
  name: string;

  /**
   * Auto-detect: does this already-parsed payload look like this provider's?
   * Only used on the /api/webhooks/alarm auto-detect path; explicit routes
   * (e.g. /api/webhooks/grafana) skip detection entirely.
   */
  detect(payload: unknown): boolean;

  /** Parse into 0..n normalized alerts. Return [] when nothing meaningful. */
  normalize(payload: unknown): NormalizedAlert[];
}
