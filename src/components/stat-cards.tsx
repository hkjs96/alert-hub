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
      accent: "text-blue-600",
    },
    {
      key: "resolved",
      label: "Resolved",
      value: stats.resolved,
      href: hrefs?.resolved ?? "/?status=RESOLVED",
      accent: "text-green-600",
    },
    {
      key: "insufficient",
      label: "No Data",
      value: stats.insufficient,
      href: hrefs?.insufficient ?? "/?status=INSUFFICIENT_DATA",
      accent: "text-gray-500",
    },
    {
      key: "total",
      label: "Total",
      value: stats.total,
      href: hrefs?.total ?? "/",
      accent: "text-slate-900",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
      {cards.map((c) => {
        const active = activeKeys.includes(c.key);
        return (
          <Link
            key={c.key}
            href={c.href}
            aria-pressed={active}
            className={`rounded-lg border bg-white p-4 shadow-sm transition hover:shadow ${
              active
                ? "border-slate-900 ring-1 ring-inset ring-slate-900"
                : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <div className="text-sm font-medium text-slate-500">{c.label}</div>
            <div className={`mt-1 text-3xl font-semibold ${c.accent}`}>
              {c.value}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
