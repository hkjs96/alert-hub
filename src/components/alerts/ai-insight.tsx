import Link from "next/link";
import { insightPolicy, latestInsightFor } from "@/server/insight";
import { rateInsightAction, requestInsight } from "@/server/insight-actions";
import { suggestionLine } from "@/lib/insight";
import { PendingButton } from "@/components/pending-button";

function ago(d: Date): string {
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`;
}

function GenerateButton({ alertId, label }: { alertId: string; label: string }) {
  return (
    <form action={requestInsight}>
      <input type="hidden" name="alertId" value={alertId} />
      <PendingButton
        pendingLabel="모델에 묻는 중…"
        className="inline-flex h-7 items-center border border-stone-200 bg-white px-3 text-xs font-medium text-stone-900 hover:border-stone-400"
      >
        {label}
      </PendingButton>
    </form>
  );
}

/**
 * "AI 메모" 카드 — 이 알람에 대해 근거(이전 처리 기록·런북·이력)로만 쓴 한 단락.
 * 근거 없는 단계는 저장 전에 버려졌고, 제안 분류의 신뢰도는 건수로 적는다.
 * 스위치가 꺼져 있고 메모도 없으면 카드 자체를 그리지 않는다.
 */
export async function AiInsightPanel({ alertId, readOnly }: { alertId: string; readOnly: boolean }) {
  const [policy, ins] = await Promise.all([insightPolicy(), latestInsightFor(alertId)]);
  if (!policy.enabled && !ins) return null;
  const canAct = !readOnly && policy.enabled;
  const sug = ins ? suggestionLine(ins) : null;

  return (
    <section id="ai" className="border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-6 py-3">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400">AI 메모</h2>
        <span className="text-xs text-stone-500">
          {ins?.status === "done"
            ? `${ins.model ?? "모델"} · ${ago(ins.updatedAt)} · 근거 ${ins.evidence.length}건`
            : "같은 고객사의 이전 처리 기록 · 런북 · 이 알람의 이력만 근거로 씁니다"}
        </span>
      </div>

      {!ins ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 text-sm text-stone-500">
          <span>이 알람에는 아직 메모가 없습니다 (통지가 나간 알람에만 자동으로 만듭니다).</span>
          {canAct ? <GenerateButton alertId={alertId} label="지금 생성" /> : null}
        </div>
      ) : ins.status === "pending" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 text-sm text-stone-500">
          <span>
            생성 대기 중 — 다음 통지 틱(1분 주기)에서 만듭니다.
            {ins.attempts > 0 ? ` 시도 ${ins.attempts}회${ins.error ? ` · 마지막 오류: ${ins.error}` : ""}` : ""}
          </span>
          {canAct ? <GenerateButton alertId={alertId} label="지금 생성" /> : null}
        </div>
      ) : ins.status === "skipped" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 text-sm text-stone-500">
          <span>
            메모를 만들지 않았습니다 · {ins.error ?? "근거 부족"}. 해결 기록이나 런북이 생기면 다음 발화부터 자동으로 만듭니다.
          </span>
          {canAct ? <GenerateButton alertId={alertId} label="지금 다시 시도" /> : null}
        </div>
      ) : ins.status === "failed" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 text-sm">
          <span className="text-[#b54708]">생성 실패 · {ins.error ?? "원인 미상"}</span>
          {canAct ? <GenerateButton alertId={alertId} label="다시 시도" /> : null}
        </div>
      ) : (
        <div className="px-6 py-4">
          <p className="text-sm leading-6 text-stone-900">{ins.summary}</p>
          {ins.likelyCause ? (
            <p className="mt-2 text-sm text-stone-700">
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400">원인 추정 </span>
              {ins.likelyCause}
            </p>
          ) : null}
          {sug ? (
            <p className="mt-2 text-sm text-stone-700">
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400">분류 제안 </span>
              {sug}
              {ins.followed === true ? <span className="ml-2 text-xs text-emerald-700">· 실제 분류와 일치</span> : null}
              {ins.followed === false ? <span className="ml-2 text-xs text-[#b54708]">· 실제 분류와 다름</span> : null}
            </p>
          ) : null}

          {ins.nextSteps.length ? (
            <ol className="mt-3 space-y-1.5">
              {ins.nextSteps.map((s, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm text-stone-800">
                  <span className="font-mono text-xs text-stone-400">{i + 1}.</span>
                  <span>{s.text}</span>
                  <span className="flex gap-1">
                    {s.evidence.map((e) => {
                      const ref = ins.evidence.find((x) => x.id === e);
                      const tag = (
                        <span className="border border-stone-200 px-1 font-mono text-[10px] text-stone-500" title={ref?.label ?? (e === "A" ? "이 알람의 이력" : e)}>
                          {e}
                        </span>
                      );
                      return ref?.alertId ? (
                        <Link key={e} href={`/alerts/${ref.alertId}`} className="hover:underline">{tag}</Link>
                      ) : (
                        <span key={e}>{tag}</span>
                      );
                    })}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-stone-400">근거가 있는 다음 단계가 없습니다.</p>
          )}

          <details className="mt-3 text-xs text-stone-500">
            <summary className="cursor-pointer select-none">근거 {ins.evidence.length}건 · 토큰 입력 {ins.inputTokens ?? "?"} / 출력 {ins.outputTokens ?? "?"}{ins.cacheReadTokens ? ` (캐시 ${ins.cacheReadTokens})` : ""}</summary>
            <ul className="mt-1.5 space-y-0.5">
              {ins.evidence.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="font-mono text-[10px] text-stone-400">{e.id}</span>
                  {e.alertId ? <Link href={`/alerts/${e.alertId}`} className="hover:underline">{e.label}</Link> : <span>{e.label}</span>}
                </li>
              ))}
              <li className="flex gap-2"><span className="font-mono text-[10px] text-stone-400">A</span><span>이 알람의 최근 이력</span></li>
            </ul>
          </details>

          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-stone-100 pt-3 text-xs text-stone-500">
            {ins.feedback ? (
              <span>{ins.feedback === "up" ? "👍 도움 됨" : "👎 도움 안 됨"}{ins.feedbackBy ? ` · ${ins.feedbackBy}` : ""}</span>
            ) : canAct ? (
              <>
                <span>도움이 됐나요?</span>
                {(["up", "down"] as const).map((f) => (
                  <form key={f} action={rateInsightAction}>
                    <input type="hidden" name="id" value={ins.id} />
                    <input type="hidden" name="alertId" value={alertId} />
                    <input type="hidden" name="feedback" value={f} />
                    <PendingButton pendingLabel="…" className="inline-flex h-7 items-center border border-stone-200 bg-white px-2.5 text-xs hover:border-stone-400">
                      {f === "up" ? "👍" : "👎"}
                    </PendingButton>
                  </form>
                ))}
              </>
            ) : null}
            {canAct ? <span className="ml-auto"><GenerateButton alertId={alertId} label="다시 생성" /></span> : null}
          </div>
        </div>
      )}
    </section>
  );
}
