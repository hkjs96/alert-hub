import Link from "next/link";
import type { getAlerts } from "@/server/alerts";
import { parseOwnershipSnapshot, type OwnershipInfo } from "@/server/org";
import { levelLabel } from "@/lib/org/resolve";
import { SeverityBadge, StatusBadge } from "@/components/badges";

type AlertRow = Awaited<ReturnType<typeof getAlerts>>[number];

/**
 * 담당 cell. Priority: the fire-time snapshot (who was actually notified),
 * then the live resolution (legacy rows / received-while-unassigned), then the
 * two "can't resolve" states.
 */
function OwnerCell({
  alert,
  ownership,
  backHref,
}: {
  alert: AlertRow;
  ownership: Map<string, OwnershipInfo>;
  /** 매핑 화면에서 돌아올 현재 대시보드 뷰 (필터 보존). */
  backHref?: string;
}) {
  const snap = parseOwnershipSnapshot(alert.ownershipSnapshot);
  if (snap && snap.order.length > 0) {
    return (
      <span
        className="text-stone-800"
        title={`수신 시점 스냅샷 · ${levelLabel(snap.level)} 단계 · ${snap.order
          .map((o) => o.name)
          .join(" → ")}`}
      >
        {snap.order[0].name}
        {snap.order.length > 1 ? (
          <span className="text-stone-400"> +{snap.order.length - 1}</span>
        ) : null}
      </span>
    );
  }

  if (!alert.accountId) {
    return (
      <span className="text-stone-300" title="페이로드에 AWS 계정 정보가 없는 알람입니다">
        —
      </span>
    );
  }
  const info = ownership.get(alert.accountId);
  if (!info) {
    const back = backHref ? `&back=${encodeURIComponent(backHref)}` : "";
    return (
      <Link
        href={`/admin/map-account?accountId=${alert.accountId}${back}`}
        className="font-medium text-amber-700 hover:underline"
        title="이 계정이 어느 서비스에도 매핑되어 있지 않습니다 — 눌러서 바로 매핑하세요"
      >
        ⚠ 매핑 필요
      </Link>
    );
  }
  const first = info.contacts[0];
  if (!first) {
    return <span className="text-stone-400">미배정</span>;
  }
  return (
    <span
      className="text-stone-800"
      title={`${levelLabel(info.responsibility.level)} 단계 순서 적용 · ${info.contacts
        .map((c) => c.name)
        .join(" → ")}`}
    >
      {first.name}
      {info.contacts.length > 1 ? (
        <span className="text-stone-400"> +{info.contacts.length - 1}</span>
      ) : null}
    </span>
  );
}

// 테이블은 좁다 — "08-30 11:13Z"면 충분하고, 초 단위 전체 시각은 상세에 있다.
function formatTime(date: Date) {
  return new Date(date).toISOString().replace("T", " ").slice(5, 16) + "Z";
}

/**
 * 제목 밑 조직 체인 보조라인 + 환경 (§6.1 테이블 요구). Live chain first;
 * the fire-time snapshot keeps both readable after the mapping is deleted.
 */
function chainFacts(
  alert: AlertRow,
  ownership: Map<string, OwnershipInfo>,
): { chain: string | null; environment: string | null } {
  const info = alert.accountId ? ownership.get(alert.accountId) : undefined;
  if (info) {
    return {
      chain: `${info.chain.customer.name} / ${info.chain.project.name} / ${info.chain.service.name}`,
      environment: info.chain.account.environment,
    };
  }
  const snap = parseOwnershipSnapshot(alert.ownershipSnapshot);
  if (snap) {
    return {
      chain: `${snap.chain.customerName} / ${snap.chain.projectName} / ${snap.chain.serviceName}`,
      environment: snap.chain.environment ?? null,
    };
  }
  return { chain: null, environment: null };
}

export function AlertTable({
  alerts,
  ownership,
  filtered = false,
  backHref,
}: {
  alerts: AlertRow[];
  ownership: Map<string, OwnershipInfo>;
  /** True when any dashboard filter is active — switches the empty state. */
  filtered?: boolean;
  /** Current dashboard view href, for round-trips (인라인 매핑 복귀). */
  backHref?: string;
}) {
  if (alerts.length === 0) {
    // "필터 결과 없음"과 "아직 데이터 없음"은 다른 상태다 (페르소나 검증 P2).
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-white p-10 text-center text-stone-500">
        {filtered ? (
          <>
            현재 필터 조건에 맞는 알람이 없습니다.{" "}
            <Link href="/" className="text-indigo-600 underline">
              필터 초기화
            </Link>
          </>
        ) : (
          <>
            No alerts yet. Send one to{" "}
            <code className="rounded bg-stone-100 px-1 py-0.5 text-sm">
              POST /api/webhooks/alarm
            </code>
            .
          </>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-stone-200 text-sm">
        <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-3 font-medium">Severity</th>
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="px-3 py-3 font-medium">Title</th>
            <th className="px-3 py-3 font-medium">Resource</th>
            <th className="px-3 py-3 font-medium">환경</th>
            <th className="px-3 py-3 font-medium">담당</th>
            <th className="px-3 py-3 font-medium text-right">Count</th>
            <th className="px-3 py-3 font-medium">Last seen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {alerts.map((a) => {
            const { chain, environment } = chainFacts(a, ownership);
            return (
            <tr key={a.id} className="hover:bg-stone-50">
              <td
                className={`border-l-[3px] px-3 py-3 ${
                  a.status === "FIRING" ? "border-l-red-600" : "border-l-transparent"
                }`}
              >
                <SeverityBadge severity={a.severity} />
              </td>
              <td className="px-3 py-3">
                <StatusBadge status={a.status} />
              </td>
              <td className="px-3 py-3">
                <Link
                  href={`/alerts/${a.id}`}
                  className="font-medium text-stone-900 hover:text-indigo-600 hover:underline"
                >
                  {a.title}
                </Link>
                {chain ? (
                  <div className="mt-0.5 text-xs text-stone-400">{chain}</div>
                ) : null}
              </td>
              <td className="px-3 py-3 text-stone-600">
                <span
                  className="block max-w-44 truncate"
                  title={a.resource ?? undefined}
                >
                  {a.resource ?? "—"}
                </span>
              </td>
              <td className="px-3 py-3">
                {environment ? (
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                    {environment}
                  </span>
                ) : (
                  <span className="text-stone-300">—</span>
                )}
              </td>
              <td className="px-3 py-3 whitespace-nowrap">
                <OwnerCell alert={a} ownership={ownership} backHref={backHref} />
              </td>
              <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-stone-600">
                {a.count}
              </td>
              <td className="px-3 py-3 whitespace-nowrap font-mono text-xs text-stone-500">
                {formatTime(a.lastSeenAt)}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
