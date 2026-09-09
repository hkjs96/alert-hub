import Link from "next/link";
import { findPriorResolutions, latestResolutionFor } from "@/server/history";
import { classifyResolution } from "@/server/history-actions";
import {
  describeItem,
  describeSummary,
  KIND_LABELS,
  RESOLUTION_KINDS,
  TIER_LABELS,
} from "@/lib/history";
import { PendingButton } from "@/components/pending-button";

function shortDate(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${parts.month}-${parts.day} ${String(Number(parts.hour) % 24).padStart(2, "0")}:${parts.minute}`;
}

/**
 * "이전 처리" 카드 — 같은 고객사·서비스의 해결 기록 5건 (가까운 키부터).
 * 알람이 RESOLVED 이고 아직 분류가 없으면 맨 위에 "어떻게 해결했나요?" 한 줄 폼.
 * 사람이 문장을 쓰는 칸은 선택이고, 라디오 하나면 끝난다.
 */
export async function PriorResolutionsPanel({
  alert,
  scope,
  readOnly,
}: {
  alert: { id: string; status: string; metric: string | null; resource: string | null };
  scope: { customerId: string | null; serviceId: string | null };
  readOnly: boolean;
}) {
  const [prior, latest] = await Promise.all([
    findPriorResolutions({
      customerId: scope.customerId,
      serviceId: scope.serviceId,
      metric: alert.metric,
      resource: alert.resource,
    }),
    alert.status === "RESOLVED" ? latestResolutionFor(alert.id) : Promise.resolve(null),
  ]);
  const askKind = latest && !latest.kind && !readOnly;
  // 이 알람 자신의 최신 기록은 목록에서 빼고 위 폼으로 보여 준다(중복 방지).
  const items = prior.items.filter((r) => r.id !== latest?.id);
  if (!scope.serviceId && !latest) return null;

  return (
    <section className="border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-6 py-3">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400">
          이전 처리
        </h2>
        <span className="text-xs text-stone-500">{describeSummary(prior.summary)}</span>
      </div>

      {latest ? (
        <div className="border-b border-stone-100 bg-stone-50 px-6 py-4">
          <div className="text-sm text-stone-700">
            이번 해결: <span className="font-medium text-stone-900">{describeItem(latest)}</span>
            {latest.note ? <span className="text-stone-500"> · “{latest.note}”</span> : null}
          </div>
          {askKind ? (
            <form action={classifyResolution} className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <input type="hidden" name="id" value={latest.id} />
              <input type="hidden" name="alertId" value={alert.id} />
              <span className="text-stone-500">어떻게 해결했나요?</span>
              {RESOLUTION_KINDS.map((k) => (
                <label key={k} className="inline-flex cursor-pointer items-center gap-1 text-stone-800">
                  <input type="radio" name="kind" value={k} required className="accent-stone-900" />
                  {KIND_LABELS[k]}
                </label>
              ))}
              <input
                name="note"
                placeholder="메모 (선택)"
                maxLength={200}
                className="h-8 w-56 rounded-md border border-stone-300 bg-white px-2.5 text-sm"
              />
              <PendingButton
                pendingLabel="기록 중…"
                className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white hover:bg-stone-700"
              >
                기록
              </PendingButton>
            </form>
          ) : null}
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="px-6 py-5 text-sm text-stone-400">
          {scope.serviceId
            ? "이 서비스에서 해결된 기록이 아직 없습니다. 해결될 때마다 여기 쌓입니다."
            : "서비스가 식별되지 않아 이전 처리를 찾을 수 없습니다."}
        </p>
      ) : (
        <ol className="divide-y divide-stone-100">
          {items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2.5 text-sm">
              <span className="font-mono text-xs text-stone-500">{shortDate(r.resolvedAt)}</span>
              <span className="font-medium text-stone-900">{describeItem(r)}</span>
              {r.note ? <span className="text-stone-500">“{r.note}”</span> : null}
              <span className="border border-stone-200 px-1 font-mono text-[11px] text-stone-400">{TIER_LABELS[r.tier]}</span>
              <Link href={`/alerts/${r.alertId}`} className="ml-auto text-xs text-indigo-600 hover:underline">
                {r.alertId === alert.id ? "이 알람의 이전 발화" : r.title}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
