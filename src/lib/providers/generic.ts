import { coerceStatus, extractSeverity, isRecord, str } from "@/lib/normalize";
import type { NormalizedAlert } from "@/lib/types";
import type { Provider } from "@/lib/providers/types";

// Catch-all: title|name + optional severity/status/source/resource/metric/
// reason/value/accountId 등. This is the fallback when nothing more specific
// matches. accountId를 버리면 담당 해석·뮤트·묶음 통지가 전부 빠지므로
// 보낸 쪽이 준 식별·보강 필드는 최대한 살린다.
function normalizeGeneric(payload: Record<string, unknown>): NormalizedAlert | null {
  const title = str(payload.title) ?? str(payload.name);
  if (!title) return null;

  const source = str(payload.source) ?? "generic";
  const resource = str(payload.resource);
  const description = str(payload.description);
  const reason = str(payload.reason) ?? str(payload.stateReason);
  const providedSeverity = str(payload.severity);
  const accountId = str(payload.accountId) ?? str(payload.account);
  const threshold =
    typeof payload.threshold === "number" ? payload.threshold : undefined;

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
    namespace: str(payload.namespace),
    value: str(payload.value),
    threshold,
    comparison: str(payload.comparison),
    region: str(payload.region),
    accountId: accountId && /^\d{12}$/.test(accountId) ? accountId : undefined,
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
