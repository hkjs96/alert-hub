import { updateServiceRunbook } from "@/server/org-actions";
import { PendingButton } from "@/components/pending-button";

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";
const overline = "font-mono text-[11px] uppercase tracking-[0.06em] text-stone-400";

/**
 * 서비스 런북: 링크 한 줄 + 본문(markdown). 링크는 Slack 알람 본문에 붙고, 본문은
 * 알람 상세에서 펼쳐 보고 이후 AI 메모가 인용한다. 비우고 저장하면 지워진다.
 */
export function ServiceRunbookEditor({
  service,
  back,
}: {
  service: { id: string; name: string; runbookUrl: string | null; runbook: string | null };
  back: string;
}) {
  const has = Boolean(service.runbookUrl || service.runbook);
  return (
    <section className="border border-stone-200 bg-white">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-stone-200 px-5 py-3">
        <h2 className={overline}>런북</h2>
        <span className="text-xs text-stone-400">
          {has ? "알람 메시지에 📖 링크가 붙고, 상세에서 본문을 펼쳐 봅니다" : "없음 — 이 서비스 알람에는 런북 링크가 붙지 않습니다"}
        </span>
      </div>
      <form action={updateServiceRunbook} className="space-y-2 p-5 text-sm">
        <input type="hidden" name="serviceId" value={service.id} />
        <input type="hidden" name="back" value={back} />
        <label className="block">
          <span className={`mb-1 block ${overline}`}>링크 (Confluence · Notion · GitHub 문서)</span>
          <input
            name="runbookUrl"
            type="url"
            defaultValue={service.runbookUrl ?? ""}
            placeholder="https://…"
            className={`${control} w-full font-mono`}
          />
        </label>
        <label className="block">
          <span className={`mb-1 block ${overline}`}>본문 (markdown · 선택)</span>
          <textarea
            name="runbook"
            defaultValue={service.runbook ?? ""}
            rows={6}
            placeholder={"## CPU 높음\n1. RDS 커넥션 수 확인 …\n2. …"}
            className="w-full rounded-md border border-stone-300 bg-white px-2.5 py-2 font-mono text-xs leading-relaxed"
          />
        </label>
        <div className="flex items-center gap-2">
          <PendingButton
            pendingLabel="저장 중…"
            className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700"
          >
            런북 저장
          </PendingButton>
          <span className="text-xs text-stone-400">
            라우팅 규칙에 런북이 있으면 그 규칙에 걸린 알람은 규칙 런북이 우선합니다.
          </span>
        </div>
      </form>
    </section>
  );
}
