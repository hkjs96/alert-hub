import Link from "next/link";
import { getAlerts, getStats } from "@/server/alerts";
import type { AlertStatus } from "@/lib/types";
import { StatCards } from "@/components/stat-cards";
import { AlertTable } from "@/components/alert-table";

export const dynamic = "force-dynamic";

const FILTERS: { label: string; value?: AlertStatus }[] = [
  { label: "All" },
  { label: "Firing", value: "FIRING" },
  { label: "Acknowledged", value: "ACKNOWLEDGED" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "No Data", value: "INSUFFICIENT_DATA" },
];

const VALID: AlertStatus[] = [
  "FIRING",
  "RESOLVED",
  "ACKNOWLEDGED",
  "INSUFFICIENT_DATA",
];

function parseStatus(raw?: string): AlertStatus | undefined {
  if (raw && (VALID as string[]).includes(raw)) return raw as AlertStatus;
  return undefined;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const active = parseStatus(searchParams.status);
  const [stats, alerts] = await Promise.all([getStats(), getAlerts(active)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Alerts</h1>
        <p className="mt-1 text-sm text-slate-500">
          Fired alarms received via the webhook, deduplicated by fingerprint.
        </p>
      </div>

      <StatCards stats={stats} />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const isActive = active === f.value || (!active && !f.value);
          const href = f.value ? `/?status=${f.value}` : "/";
          return (
            <Link
              key={f.label}
              href={href}
              className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                isActive
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-100"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <AlertTable alerts={alerts} />
    </div>
  );
}
