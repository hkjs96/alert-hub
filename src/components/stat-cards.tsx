import Link from "next/link";
import type { AlertStats } from "@/server/alerts";

type CardKey = "firing" | "acknowledged" | "resolved" | "insufficient" | "total";

interface CardDef {
  key: CardKey;
  label: string;
  value: number;
  href: string;
  accent: string;
}

/**
 * 스탯 타일 5개 (§6.1). 클릭 = 해당 상태 필터 토글 — the dashboard passes
 * toggle hrefs that preserve its other filters; without them the tiles fall
 * back to plain single-status links. activeKeys rings the tiles whose status
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
      label: "Firing",
      value: stats.firing,
      href: hrefs?.firing ?? "/?status=FIRING",
      accent: "text-red-600",
    },
    {
      key: "acknowledged",
      label: "Acked",
      value: stats.acknowledged,
      href: hrefs?.acknowledged ?? "/?status=ACKNOWLEDGED",
      accent: "text-stone-900",
    },
    {
      key: "resolved",
      label: "Resolved",
      value: stats.resolved,
      href: hrefs?.resolved ?? "/?status=RESOLVED",
      accent: "text-stone-900",
    },
    {
      key: "insufficient",
      label: "No Data",
      value: stats.insufficient,
      href: hrefs?.insufficient ?? "/?status=INSUFFICIENT_DATA",
      accent: "text-stone-400",
    },
    {
      key: "total",
      label: "Total",
      value: stats.total,
      href: hrefs?.total ?? "/",
      accent: "text-stone-900",
    },
  ];

  // B안: 떠 있는 카드 대신 1px 이음선으로 붙은 타일 밴드 — 다섯 수치가 한
  // 줄의 계기판으로 읽힌다. 활성 상태는 인디고 틴트.
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200 sm:grid-cols-5">
      {cards.map((c) => {
        const active = activeKeys.includes(c.key);
        return (
          <Link
            key={c.key}
            href={c.href}
            aria-pressed={active}
            className={`p-4 transition ${
              active ? "bg-indigo-50" : "bg-white hover:bg-stone-50"
            }`}
          >
            <div
              className={`text-xs font-medium ${
                active ? "text-indigo-700" : "text-stone-500"
              }`}
            >
              {c.label}
            </div>
            <div
              className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${c.accent}`}
            >
              {c.value}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
