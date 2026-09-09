import { linksForAlert } from "@/server/runbook";

/**
 * 런북 · 콘솔 카드. 런북 링크와 본문(펼치기), CloudWatch 콘솔 딥링크.
 * 둘 다 없으면 렌더하지 않는다.
 */
export async function AlertLinksPanel({
  alert,
  ruleId,
  serviceId,
}: {
  alert: { fingerprint: string };
  ruleId: string | null;
  serviceId: string | null;
}) {
  const { links, runbook } = await linksForAlert({ fingerprint: alert.fingerprint, ruleId, serviceId });
  if (!links.length && !runbook?.text) return null;
  return (
    <section className="border border-stone-200 bg-white">
      <div className="border-b border-stone-200 px-6 py-3">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400">런북 · 콘솔</h2>
      </div>
      <div className="space-y-3 p-6 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center border border-stone-200 bg-white px-3 text-sm font-medium text-stone-900 transition-colors hover:border-stone-400"
            >
              {l.label} ↗
            </a>
          ))}
          {links.some((l) => l.label.includes("CloudWatch")) ? (
            <span className="text-xs text-stone-400">콘솔은 로그인된 AWS 계정으로 열립니다 — 해당 고객사 계정으로 스위치한 뒤 누르세요.</span>
          ) : null}
        </div>
        {runbook?.text ? (
          <details className="border border-stone-100 bg-stone-50">
            <summary className="cursor-pointer select-none px-4 py-2.5 text-sm text-stone-700 hover:text-stone-900">
              런북 본문 ({runbook.source})
            </summary>
            <pre className="whitespace-pre-wrap px-4 pb-4 font-mono text-xs leading-relaxed text-stone-800">{runbook.text}</pre>
          </details>
        ) : null}
      </div>
    </section>
  );
}
