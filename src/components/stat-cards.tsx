import Link from "next/link";
import type { AlertStats } from "@/server/alerts";
import { Mark, statusTone } from "@/components/badges";

type CardKey = "firing" | "acknowledged" | "resolved" | "insufficient" | "total";

interface CardDef {
  key: CardKey;
  label: string;
  value: number;
  href: string;
  status: string | null;
}

/**
 * 스탯 타일 5개 (§6.1). 클릭 = 해당 상태 필터 토글 — the dashboard passes
 * toggle hrefs that preserve its other filters; without them the tiles fall
 * back to plain single-status links. activeKeys marks the tiles whose status
 * is currently in the filter set.
 */
export function StatCards({
  stats,
  hrefs,
  activeKeys = [],
}: {
  stats: AlertStats;
  hrefs?: Partial<Record<CardKey, string>>;
  activeKeys?: string[];
}) {
  const cards: CardDef[] = [
    {
      key: "firing",
      label: "FIRING",
      value: stats.firing,
      href: hrefs?.firing ?? "/?status=FIRING",
      status: "FIRING",
    },
    {
      key: "acknowledged",
      label: "ACKED",
      value: stats.acknowledged,
      href: hrefs?.acknowledged ?? "/?status=ACKNOWLEDGED",
      status: "ACKNOWLEDGED",
    },
    {
      key: "resolved",
      label: "RESOLVED",
      value: stats.resolved,
      href: hrefs?.resolved ?? "/?status=RESOLVED",
      status: "RESOLVED",
    },
    {
      key: "insufficient",
      label: "NO DATA",
      value: stats.insufficient,
      href: hrefs?.insufficient ?? "/?status=INSUFFICIENT_DATA",
      status: "INSUFFICIENT_DATA",
    },
    {
      key: "total",
      label: "TOTAL",
      value: stats.total,
      href: hrefs?.total ?? "/",
      status: null,
    },
  ];

  // v2: 흰 바탕 한 상자 안에서 헤어라인으로만 나뉘는 계기판. 각 타일은
  // 상태 도형 마크 + 모노 오버라인 + Space Mono 큰 수치. 활성 타일은 상태색
  // 밑줄(inset)과 옅은 틴트로 표시한다.
  return (
    <div className="grid grid-cols-2 border border-stone-200 bg-white sm:grid-cols-5">
      {cards.map((c, i) => {
        const active = activeKeys.includes(c.key);
        const tone = c.status ? statusTone(c.status) : null;
        const accent = tone?.color ?? "#1b1a17";
        return (
          <Link
            key={c.key}
            href={c.href}
            aria-pressed={active}
            className={`px-[18px] py-[17px] transition-colors ${
              i < cards.length - 1 ? "border-r border-stone-100" : ""
            } ${active ? "" : "hover:bg-stone-50"}`}
            style={
              active
                ? {
                    background: c.key === "firing" ? "#fdf5f4" : "#faf8f4",
                    boxShadow: `inset 0 -2px 0 ${accent}`,
                  }
                : undefined
            }
          >
            <div className="flex items-center gap-[7px]">
              {tone ? (
                <Mark {...tone} />
              ) : (
                <span className="inline-block h-[1.5px] w-2 bg-stone-300" />
              )}
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-500">
                {c.label}
              </span>
            </div>
            <div
              className={`mt-3 font-mono text-[32px] leading-none tracking-[-0.02em] ${
                active ? "font-bold" : "font-normal"
              }`}
              style={{
                color:
                  c.key === "firing" && (active || c.value > 0)
                    ? "#b42318"
                    : c.key === "insufficient"
                      ? "#8a877f"
                      : "#1b1a17",
              }}
            >
              {c.value}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
