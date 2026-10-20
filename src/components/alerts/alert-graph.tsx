import { readerFor } from "@/server/graph";

/** 알람 상세의 CloudWatch 그래프 — 그 계정에 읽기 역할이 연결돼 있을 때만. 이미지는 라우트가 스코프 검사 후 받아 온다. */
export async function AlertGraphPanel({ alertId, accountId }: { alertId: string; accountId: string | null }) {
  if (!(await readerFor(accountId))) return null;
  return (
    <section className="border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-6 py-3">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400">지표 그래프</h2>
        <span className="text-xs text-stone-500">CloudWatch · 최근 3시간 · 빨간 선 = 발화, 주황 선 = 임계값</span>
      </div>
      <div className="p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/alerts/${alertId}/graph`} alt="CloudWatch 지표 그래프" className="max-w-full" loading="lazy" />
      </div>
    </section>
  );
}
