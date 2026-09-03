import { Mark } from "@/components/badges";

/** 인증 화면 공용 조각 — 톤 마크·라벨, 키-값 표, 참조 코드 줄. */

export type AuthTone = "err" | "warn" | "info" | "ok" | "off";

export const TONE: Record<AuthTone, { color: string; shape: "dot" | "ring" | "tri" | "check" | "dash" }> = {
  err: { color: "#b42318", shape: "dot" },
  warn: { color: "#b54708", shape: "tri" },
  info: { color: "#4a5568", shape: "ring" },
  ok: { color: "#067647", shape: "check" },
  off: { color: "#8a877f", shape: "dash" },
};

export function ToneLabel({ tone, children }: { tone: AuthTone; children: React.ReactNode }) {
  const t = TONE[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[10px] font-bold tracking-[0.08em]"
      style={{ color: t.color }}
    >
      <Mark color={t.color} shape={t.shape} />
      {children}
    </span>
  );
}

export const overline = "font-mono text-[10px] font-bold tracking-[0.11em] text-stone-400";

export function KvTable({ rows }: { rows: { k: string; v: React.ReactNode; mono?: boolean }[] }) {
  return (
    <div className="border border-[#eeebe4] bg-stone-50">
      <div className="grid grid-cols-[96px_1fr]">
        {rows.map((r, i) => (
          <div key={r.k} className="contents">
            <div className={`px-3.5 py-2.5 font-mono text-[10px] font-bold tracking-[0.09em] text-stone-400 ${i ? "border-t border-[#eeebe4]" : ""}`}>
              {r.k}
            </div>
            <div className={`px-3.5 py-2.5 text-[#4a4842] ${r.mono ? "font-mono text-xs" : "text-sm font-medium"} ${i ? "border-t border-[#eeebe4]" : ""}`}>
              {r.v}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RefLine({ code, note = "지원 문의 시 이 코드를 알려주세요" }: { code: string; note?: string }) {
  return (
    <div className="mt-4 border-t border-[#f4f1ea] pt-3.5 font-mono text-[11px] text-stone-300">
      참조 <span className="text-stone-400">{code}</span> · {note}
    </div>
  );
}

export const btnPrimaryInk =
  "inline-flex h-9 items-center border border-stone-900 bg-stone-900 px-[15px] text-[13px] font-semibold text-white transition-colors hover:bg-black";
export const btnPrimaryAccent =
  "inline-flex h-9 items-center border border-indigo-600 bg-indigo-600 px-[15px] text-[13px] font-semibold text-white transition-colors hover:bg-indigo-700";
export const btnSecondary =
  "inline-flex h-9 items-center border border-stone-200 bg-white px-3.5 text-[13px] font-medium text-stone-900 transition-colors hover:border-stone-400";
export const btnSmall =
  "inline-flex h-[30px] items-center border border-stone-200 bg-white px-[13px] text-xs font-medium text-stone-500 transition-colors hover:border-stone-400 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50";
export const btnSmallInk =
  "inline-flex h-[30px] items-center border border-stone-900 bg-white px-[13px] text-xs font-semibold text-stone-900 transition-colors hover:bg-stone-50";
