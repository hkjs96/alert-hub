import { graphStatusFor } from "@/server/graph";

/**
 * 알람 상세의 CloudWatch 그래프. Slack 알람 본문에도 같은 그래프(발화 전후 3시간)가 들어간다.
 * 그래프가 안 나오면 이유를 그대로 보여 준다. 이미지는 라우트가 스코프 검사 후 받아 온다.
 */
export async function AlertGraphPanel({ alertId }: { alertId: string }) {
  const st = await graphStatusFor(alertId);
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
          <p className="text-xs text-stone-400">Slack 알람 본문에도 발화 전후 3시간 그래프가 들어갑니다 (연결 이후 발화부터).</p>
        </div>
      )}
    </section>
  );
}
