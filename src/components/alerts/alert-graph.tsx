import { graphStatusFor } from "@/server/graph";
import { retryGraph } from "@/server/aws-actions";
import { PendingButton } from "@/components/pending-button";

/**
 * 알람 상세의 CloudWatch 그래프 + Slack 첨부 상태. 그래프가 안 나오면 이유를 그대로 보여 준다
 * (역할 미설정·대기 중·실패 사유). 이미지는 라우트가 스코프 검사 후 받아 온다.
 */
export async function AlertGraphPanel({ alertId, readOnly }: { alertId: string; readOnly: boolean }) {
  const st = await graphStatusFor(alertId);
  const slackLine =
    st.kind === "done"
      ? { tone: "text-emerald-700", text: "Slack 메시지에 첨부됨" }
      : st.kind === "pending"
        ? { tone: "text-stone-500", text: `Slack 첨부 대기 중 (통지 틱 1분 주기)${st.attempts ? ` · 시도 ${st.attempts}회` : ""}${st.error ? ` · 마지막 오류: ${st.error}` : ""}` }
        : st.kind === "failed"
          ? { tone: "text-[#b54708]", text: `Slack 첨부 실패 · ${st.error ?? "원인 미상"}` }
          : st.kind === "skipped"
            ? { tone: "text-stone-400", text: `Slack 첨부 건너뜀 · ${st.reason ?? ""}` }
          : st.kind === "idle"
            ? { tone: "text-stone-400", text: "이 발화는 그래프 첨부 대상이 아니었습니다 (연결 전에 왔거나 통지가 생략된 발화)" }
            : null;

  return (
    <section className="border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-6 py-3">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400">지표 그래프</h2>
        <span className="text-xs text-stone-500">CloudWatch · 최근 3시간 · 빨간 선 = 발화, 주황 선 = 임계값</span>
      </div>
      {st.kind === "off" ? (
        <p className="px-6 py-4 text-sm text-stone-500">그래프를 받을 수 없습니다 — {st.reason}</p>
      ) : (
        <div className="space-y-2 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/alerts/${alertId}/graph`} alt="CloudWatch 지표 그래프 (불러오지 못하면 아래 사유 참고)" className="max-w-full" loading="lazy" />
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {slackLine ? <span className={slackLine.tone}>{slackLine.text}</span> : null}
            {!readOnly && st.kind !== "pending" ? (
              <form action={retryGraph} className="ml-auto">
                <input type="hidden" name="alertId" value={alertId} />
                <PendingButton pendingLabel="요청 중…" className="inline-flex h-7 items-center border border-stone-200 bg-white px-3 text-xs font-medium text-stone-900 hover:border-stone-400">
                  Slack 에 다시 올리기
                </PendingButton>
              </form>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
