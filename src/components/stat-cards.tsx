import Link from "next/link";
import type { AlertStats } from "@/server/alerts";

interface CardDef {
  key: string;
  label: string;
  value: number;
  href: string;
  accent: string;
}

export function StatCards({ stats }: { stats: AlertStats }) {
  const cards: CardDef[] = [
    {
      key: "firing",
      label: "Firing",
      value: stats.firing,
      href: "/?status=FIRING",
      accent: "text-red-600",
    },
    {
      key: "resolved",
      label: "Resolved",
      value: stats.resolved,
      href: "/?status=RESOLVED",
      accent: "text-green-600",
    },
    {
      key: "insufficient",
      label: "No Data",
      value: stats.insufficient,
      href: "/?status=INSUFFICIENT_DATA",
      accent: "text-gray-500",
    },
    {
      key: "total",
      label: "Total",
      value: stats.total,
      href: "/",
      accent: "text-slate-900",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {cards.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow"
        >
          <div className="text-sm font-medium text-slate-500">{c.label}</div>
          <div className={`mt-1 text-3xl font-semibold ${c.accent}`}>
            {c.value}
          </div>
        </Link>
      ))}
    </div>
  );
}
