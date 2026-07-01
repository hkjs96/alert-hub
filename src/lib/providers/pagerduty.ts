import { isRecord, str } from "@/lib/normalize";
import type { AlertStatus, NormalizedAlert } from "@/lib/types";
import type { Provider } from "@/lib/providers/types";

// PagerDuty is normally a destination; here we receive its *outbound* webhooks
// on incident lifecycle changes. Two generations:
//  - v3 Webhook Subscriptions (current): single `{ event: { event_type, data } }`,
//    event_type like `incident.triggered` (past tense). ← PoC target.
//  - v1/v2 (deprecated): `{ messages: [{ event: "incident.trigger", ... }] }`
//    (present tense, batched). ← best-effort.

/** Map a PagerDuty lifecycle verb onto our status enum. */
function statusFromEventType(eventType: string | undefined): AlertStatus {
  const verb = (eventType ?? "").toLowerCase();
  if (verb.includes("acknowledge")) return "ACKNOWLEDGED";
  if (verb.includes("resolve")) return "RESOLVED";
  // triggered / reopened / escalated / annotated / ... → treat as active.
  return "FIRING";
}

function severityFromIncident(data: Record<string, unknown>): string {
  const priority = isRecord(data.priority) ? str(data.priority.summary) : undefined;
  if (priority) return priority.toUpperCase();
  const urgency = str(data.urgency);
  return urgency ? urgency.toUpperCase() : "UNKNOWN";
}

function normalizeIncident(
  data: Record<string, unknown>,
  status: AlertStatus,
  stateReason: string | undefined,
): NormalizedAlert | null {
  const id = str(data.id);
  const title = str(data.title) ?? str(data.summary);
  if (!id && !title) return null;

  const service = isRecord(data.service) ? str(data.service.summary) : undefined;

  return {
    fingerprint: `pagerduty:${id ?? title}`,
    title: title ?? `incident ${id}`,
    description: str(data.description),
    source: "pagerduty",
    severity: severityFromIncident(data),
    status,
    resource: service,
    stateReason: stateReason ?? str(data.status),
    raw: data,
  };
}

function looksLikePagerDuty(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (isRecord(payload.event) && "event_type" in payload.event) return true; // v3
  if (Array.isArray(payload.messages)) return true; // v1/v2
  return false;
}

export const pagerdutyProvider: Provider = {
  name: "pagerduty",
  detect: looksLikePagerDuty,
  normalize(payload) {
    if (!isRecord(payload)) return [];

    // v3: single event object.
    if (isRecord(payload.event)) {
      const event = payload.event;
      const eventType = str(event.event_type);
      const data = isRecord(event.data) ? event.data : {};
      const alert = normalizeIncident(
        data,
        statusFromEventType(eventType),
        eventType,
      );
      return alert ? [alert] : [];
    }

    // v1/v2: batched messages.
    if (Array.isArray(payload.messages)) {
      const out: NormalizedAlert[] = [];
      for (const msg of payload.messages) {
        if (!isRecord(msg)) continue;
        const eventType = str(msg.event) ?? str(msg.type);
        const rawData = isRecord(msg.data) ? msg.data : msg;
        const incident = isRecord(rawData.incident) ? rawData.incident : rawData;
        const alert = normalizeIncident(
          incident,
          statusFromEventType(eventType),
          eventType,
        );
        if (alert) out.push(alert);
      }
      return out;
    }

    return [];
  },
};
