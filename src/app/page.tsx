import Link from "next/link";
import { getAlerts, getStats } from "@/server/alerts";
import { getOwnershipByAccountIds } from "@/server/org";
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

/** Keep the status and unmapped filters independent in the query string. */
function href(patch: { status?: AlertStatus; unmapped?: boolean }): string {
  const params = new URLSearchParams();
  if (patch.status) params.set("status", patch.status);
  if (patch.unmapped) params.set("unmapped", "1");
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { status?: string; unmapped?: string };
}) {
  const active = parseStatus(searchParams.status);
  const onlyUnmapped = searchParams.unmapped === "1";
  const [stats, allAlerts] = await Promise.all([getStats(), getAlerts(active)]);

  const ownership = await getOwnershipByAccountIds(
    allAlerts.map((a) => a.accountId).filter((id): id is string => Boolean(id)),
  );

  // Unmapped = the alert carries an account id but no AwsAccountMap row knows
  // it. An alert with no account id at all is a different state (계정 정보 없음).
  const isUnmapped = (a: { accountId: string | null }) =>
    Boolean(a.accountId) && !ownership.has(a.accountId as string);
  const unmappedCount = allAlerts.filter(isUnmapped).length;
  const alerts = onlyUnmapped ? allAlerts.filter(isUnmapped) : allAlerts;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Alerts</h1>
        <p className="mt-1 text-sm text-slate-500">
          Fired alarms received via the webhook, deduplicated by fingerprint.
        </p>
      </div>

      {unmappedCount > 0 && !onlyUnmapped && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-800">
            ⚠ 매핑되지 않은 AWS 계정에서 발생한 알람이 {unmappedCount}건
            있습니다.
          </p>
          <Link
            href={href({ status: active, unmapped: true })}
            className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1 text-sm font-medium text-amber-800 hover:bg-amber-100"
          >
            미매핑만 보기
          </Link>
        </div>
      )}

      {onlyUnmapped && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-800">
            미매핑 계정의 알람만 보고 있습니다.{" "}
            <Link href="/admin/customers" className="underline">
              조직 · 담당자 관리
            </Link>
            의 서비스 페이지에서 계정을 매핑하면 담당이 잡힙니다.
          </p>
          <Link
            href={href({ status: active })}
            className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1 text-sm font-medium text-amber-800 hover:bg-amber-100"
          >
            전체 보기
          </Link>
        </div>
      )}

      <StatCards stats={stats} />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const isActive = active === f.value || (!active && !f.value);
          return (
            <Link
              key={f.label}
              href={href({ status: f.value, unmapped: onlyUnmapped })}
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

      <AlertTable alerts={alerts} ownership={ownership} />
    </div>
  );
}
