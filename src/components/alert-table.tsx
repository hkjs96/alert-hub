import Link from "next/link";
import type { getAlerts } from "@/server/alerts";
import { SeverityBadge, StatusBadge } from "@/components/badges";

type AlertRow = Awaited<ReturnType<typeof getAlerts>>[number];

function formatTime(date: Date) {
  return new Date(date).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function AlertTable({ alerts }: { alerts: AlertRow[] }) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
        No alerts yet. Send one to{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-sm">
          POST /api/webhooks/alarm
        </code>
        .
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Severity</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Title</th>
            <th className="px-4 py-3 font-medium">Source</th>
            <th className="px-4 py-3 font-medium">Resource</th>
            <th className="px-4 py-3 font-medium text-right">Count</th>
            <th className="px-4 py-3 font-medium">Last seen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {alerts.map((a) => (
            <tr key={a.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <SeverityBadge severity={a.severity} />
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={a.status} />
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/alerts/${a.id}`}
                  className="font-medium text-slate-900 hover:text-blue-600 hover:underline"
                >
                  {a.title}
                </Link>
              </td>
              <td className="px-4 py-3 text-slate-600">{a.source}</td>
              <td className="px-4 py-3 text-slate-600">{a.resource ?? "—"}</td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                {a.count}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                {formatTime(a.lastSeenAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
