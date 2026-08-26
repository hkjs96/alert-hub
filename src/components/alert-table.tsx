import Link from "next/link";
import type { getAlerts } from "@/server/alerts";
import type { OwnershipInfo } from "@/server/org";
import { levelLabel } from "@/lib/org/resolve";
import { SeverityBadge, StatusBadge } from "@/components/badges";

type AlertRow = Awaited<ReturnType<typeof getAlerts>>[number];

/** 담당 cell: resolved 1순위, or one of the two "can't resolve" states. */
function OwnerCell({
  alert,
  ownership,
}: {
  alert: AlertRow;
  ownership: Map<string, OwnershipInfo>;
}) {
  if (!alert.accountId) {
    return (
      <span className="text-slate-300" title="페이로드에 AWS 계정 정보가 없는 알람입니다">
        —
      </span>
    );
  }
  const info = ownership.get(alert.accountId);
  if (!info) {
    return (
      <Link
        href="/admin/customers"
        className="font-medium text-amber-700 hover:underline"
        title="이 계정이 어느 서비스에도 매핑되어 있지 않습니다 — 서비스 페이지에서 매핑하세요"
      >
        ⚠ 매핑 필요
      </Link>
    );
  }
  const first = info.contacts[0];
  if (!first) {
    return <span className="text-slate-400">미배정</span>;
  }
  return (
    <span
      className="text-slate-800"
      title={`${levelLabel(info.responsibility.level)} 단계 순서 적용 · ${info.contacts
        .map((c) => c.name)
        .join(" → ")}`}
    >
      {first.name}
      {info.contacts.length > 1 ? (
        <span className="text-slate-400"> +{info.contacts.length - 1}</span>
      ) : null}
    </span>
  );
}

function formatTime(date: Date) {
  return new Date(date).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function AlertTable({
  alerts,
  ownership,
}: {
  alerts: AlertRow[];
  ownership: Map<string, OwnershipInfo>;
}) {
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
            <th className="px-4 py-3 font-medium">담당</th>
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
              <td className="px-4 py-3 whitespace-nowrap">
                <OwnerCell alert={a} ownership={ownership} />
              </td>
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
