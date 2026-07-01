// Provider-agnostic types shared across the ingest pipeline.
//
// The normalization layer turns any incoming payload (SNS envelope, raw
// CloudWatch alarm JSON, or a generic alert JSON) into a single
// `NormalizedAlert` shape. Everything downstream — storage, dashboard, and
// notifiers — only ever sees this common form, so adding new sources later
// does not change how alerts are stored or displayed.

export type AlertStatus =
  | "FIRING"
  | "RESOLVED"
  | "ACKNOWLEDGED"
  | "INSUFFICIENT_DATA";

export interface NormalizedAlert {
  /**
   * Stable dedup key. Identical fingerprints are treated as the same alert and
   * upserted. CloudWatch => `cw:<AlarmArn>`; generic => `source:title:resource`.
   */
  fingerprint: string;

  title: string;
  description?: string;

  source: string;
  severity: string;
  status: AlertStatus;

  resource?: string;
  metric?: string;
  namespace?: string;
  value?: string;
  threshold?: number;
  comparison?: string;
  region?: string;
  accountId?: string;
  stateReason?: string;

  /** Original payload, retained for debugging / future enrichment. */
  raw?: unknown;
}
