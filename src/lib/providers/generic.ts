import { coerceStatus, extractSeverity, isRecord, str } from "@/lib/normalize";
import type { NormalizedAlert } from "@/lib/types";
import type { Provider } from "@/lib/providers/types";

// Catch-all: title|name + optional severity/status/source/resource/metric/
// reason/value. This is the fallback when nothing more specific matches.
function normalizeGeneric(payload: Record<string, unknown>): NormalizedAlert | null {
  const title = str(payload.title) ?? str(payload.name);
  if (!title) return null;

  const source = str(payload.source) ?? "generic";
  const resource = str(payload.resource);
  const description = str(payload.description);
  const reason = str(payload.reason);
  const providedSeverity = str(payload.severity);

  return {
    fingerprint: `${source}:${title}:${resource ?? ""}`,
    title,
    description,
    source,
    severity: providedSeverity
      ? providedSeverity.toUpperCase()
      : extractSeverity(title, description, reason),
    status: coerceStatus(str(payload.status)),
    resource,
    metric: str(payload.metric),
    value: str(payload.value),
    stateReason: reason,
    raw: payload,
  };
}

export const genericProvider: Provider = {
  name: "generic",
  detect(payload) {
    return isRecord(payload) && Boolean(str(payload.title) ?? str(payload.name));
  },
  normalize(payload) {
    if (!isRecord(payload)) return [];
    const alert = normalizeGeneric(payload);
    return alert ? [alert] : [];
  },
};
