import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAlerts } from "@/server/alerts";
import {
  getOwnershipByAccountIds,
  parseOwnershipSnapshot,
  type OwnershipInfo,
} from "@/server/org";
import type { AlertStatus } from "@/lib/types";
import {
  anyFilterActive,
  dashboardHref,
  matchesFilters,
  parseStatusParam,
  UNASSIGNED,
  type AlertFacts,
  type DashboardFilters,
} from "@/lib/alert-filters";
import { StatCards } from "@/components/stat-cards";
import { AlertTable } from "@/components/alert-table";
import { Mark, statusTone } from "@/components/badges";
import { getActiveSilences } from "@/server/silences";
import { matchSilence, type SilenceRow } from "@/lib/silence";
import { bulkAckAlerts } from "@/server/alert-actions";
import { ackMinutesFromEnv } from "@/lib/escalation";
import { PendingButton } from "@/components/pending-button";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { isReadOnly } from "@/server/auth";

export const dynamic = "force-dynamic";

const STATUS_CHIPS: { label: string; value: AlertStatus }[] = [
  { label: "FIRING", value: "FIRING" },
  { label: "ACKNOWLEDGED", value: "ACKNOWLEDGED" },
  { label: "RESOLVED", value: "RESOLVED" },
  { label: "NO DATA", value: "INSUFFICIENT_DATA" },
];

type AlertRow = Awaited<ReturnType<typeof getAlerts>>[number];

const filterControl =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";

/**
 * Flatten one alert + its resolved ownership into what the filters see.
 * primary(1순위)는 수신 시점 스냅샷이 우선 — 테이블의 담당 표기와 같은 규칙
 * 이라, 담당 패널에서 누른 사람과 테이블에 보이는 이름이 어긋나지 않는다.
 */
function factsOf(a: AlertRow, ownership: Map<string, OwnershipInfo>): AlertFacts {
  const info = a.accountId ? ownership.get(a.accountId) : undefined;
  const snap = parseOwnershipSnapshot(a.ownershipSnapshot);
  const primary = snap?.order[0]
    ? { id: snap.order[0].contactId, name: snap.order[0].name }
    : info?.contacts[0]
      ? { id: info.contacts[0].id, name: info.contacts[0].name }
      : null;
  return {
    status: a.status,
    title: a.title,
    resource: a.resource,
    metric: a.metric,
    namespace: a.namespace,
    description: a.description,
    accountId: a.accountId,
    chain: info
      ? {
          customerId: info.chain.customer.id,
          projectId: info.chain.project.id,
          serviceId: info.chain.service.id,
          environment: info.chain.account.environment,
        }
      : null,
    primary,
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: {
    customer?: string;
    project?: string;
    env?: string;
    status?: string;
    q?: string;
    assignee?: string;
    unmapped?: string;
  };
}) {
  const f: DashboardFilters = {
    customer: searchParams.customer || undefined,
    project: searchParams.project || undefined,
    env: searchParams.env || undefined,
    statuses: parseStatusParam(searchParams.status),
    q: searchParams.q?.trim() || undefined,
    assignee: searchParams.assignee || undefined,
    unmapped: searchParams.unmapped === "1",
  };

  const [allAlerts, customers, allProjects, envRows, silences] = await Promise.all([
    getAlerts(),
    prisma.customer.findMany({ orderBy: { name: "asc" } }),
    prisma.project.findMany({
      orderBy: [{ customer: { name: "asc" } }, { name: "asc" }],
      include: { customer: { select: { name: true } } },
    }),
    prisma.awsAccountMap.findMany({
      where: { environment: { not: null } },
      select: { environment: true },
      distinct: ["environment"],
    }),
    getActiveSilences(),
  ]);
  const envs = envRows
    .map((r) => r.environment)
    .filter((e): e is string => Boolean(e))
    .sort();

  // 프로젝트 드롭다운은 항상 열려 있다: 고객사를 고르면 그 고객사 것만, 아니면
  // 전체를 고객사별 그룹으로. 프로젝트만 골랐으면 고객사는 거기서 따라온다.
  // 고객사를 바꿔 제출해 프로젝트가 다른 고객사 것이 되면 고객사 선택이 이긴다.
  const chosenProject = f.project ? allProjects.find((p) => p.id === f.project) : undefined;
  if (chosenProject && !f.customer) f.customer = chosenProject.customerId;
  if (chosenProject && chosenProject.customerId !== f.customer) f.project = undefined;
  if (f.project && !chosenProject) f.project = undefined;
  const projects = f.customer
    ? allProjects.filter((p) => p.customerId === f.customer)
    : allProjects;

  // GET 폼은 빈 칸도 `customer=&q=`로 실어 보낸다. 빈 값이 하나라도 있으면
  // 정규 URL(비어 있지 않은 것만, 파생된 고객사 포함)로 한 번 돌려보낸다 —
  // 공유·북마크되는 주소가 깔끔해지고 프로젝트→고객사 파생도 URL에 남는다.
  if (Object.values(searchParams).some((v) => v === "")) {
    redirect(dashboardHref(f));
  }

  const ownership = await getOwnershipByAccountIds(
    allAlerts.map((a) => a.accountId).filter((id): id is string => Boolean(id)),
  );

  const rows = allAlerts.map((a) => ({ a, facts: factsOf(a, ownership) }));
  const readOnly = await isReadOnly();

  // 스탯 타일은 "상태를 제외한 현재 필터" 기준이다 (페르소나 검증 P1: 필터를
  // 걸었는데 타일이 전체 수치를 보여줘 오독). 상태만 빼는 이유는 타일 자체가
  // 상태 토글이라서 — 담당 패널이 assignee를 빼고 세는 것과 같은 원리.
  const tileBase = rows.filter((r) =>
    matchesFilters(r.facts, { ...f, statuses: [] }),
  );
  const countOf = (s: AlertStatus) =>
    tileBase.filter((r) => r.a.status === s).length;
  const stats = {
    firing: countOf("FIRING"),
    acknowledged: countOf("ACKNOWLEDGED"),
    resolved: countOf("RESOLVED"),
    insufficient: countOf("INSUFFICIENT_DATA"),
    total: tileBase.length,
  };

  // Unmapped = the alert carries an account id but no AwsAccountMap row knows
  // it. An alert with no account id at all is a different state (계정 정보 없음).
  // 배너도 현재 필터 시야를 존중한다 — 고객사 필터가 걸려 있으면 조직 미상인
  // 미매핑 알람은 그 시야 밖이므로 배너가 사라진다 (페르소나 검증 P2).
  const unmappedCount = rows.filter((r) =>
    matchesFilters(r.facts, { ...f, unmapped: true }),
  ).length;

  // 담당 패널 건수는 assignee를 뺀 나머지 필터 기준으로 계산: 한 명을 골라도
  // 패널 전체가 사라지지 않고, 지금 보고 있는 모집단의 분포가 유지된다.
  const panelBase = rows.filter((r) =>
    matchesFilters(r.facts, { ...f, assignee: undefined }),
  );
  const byAssignee = new Map<string, { name: string; count: number }>();
  for (const r of panelBase) {
    const key = r.facts.primary?.id ?? UNASSIGNED;
    const name = r.facts.primary?.name ?? "미지정";
    const entry = byAssignee.get(key) ?? { name, count: 0 };
    entry.count += 1;
    byAssignee.set(key, entry);
  }
  const panel = [...byAssignee.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((x, y) =>
      x.id === UNASSIGNED ? 1 : y.id === UNASSIGNED ? -1 : y.count - x.count,
    );

  const visible = rows.filter((r) => matchesFilters(r.facts, f)).map((r) => r.a);

  // 뮤트 칩: 행별로 지금 유효한 Silence를 매칭한다. 뮤트여도 행은 그대로
  // 보인다 — 숨기는 게 아니라 "깨우지 않는" 것이 뮤트의 의미라서다.
  const now = new Date();
  const mutedById = new Map<string, SilenceRow>();
  for (const r of rows) {
    const hit = matchSilence(
      silences,
      {
        alertId: r.a.id,
        customerId: r.facts.chain?.customerId,
        projectId: r.facts.chain?.projectId,
        serviceId: r.facts.chain?.serviceId,
      },
      now,
    );
    if (hit) mutedById.set(r.a.id, hit);
  }

  const toggleStatus = (s: AlertStatus) =>
    dashboardHref({
      ...f,
      statuses: f.statuses.includes(s)
        ? f.statuses.filter((x) => x !== s)
        : [...f.statuses, s],
    });
  const toggleAssignee = (id: string) =>
    dashboardHref({ ...f, assignee: f.assignee === id ? undefined : id });

  // 일괄 Ack 대상: 지금 화면(필터 결과)의 FIRING들. 제출 사이에 변한 행은
  // 서버 가드가 걸러낸다.
  const firingVisible = visible.filter((a) => a.status === "FIRING");

  // 에스컬레이션 대기 (v2 우측 카드): 사다리가 남은 FIRING의 다음 통지 예정.
  const ackMinutes = ackMinutesFromEnv();
  const escalationQueue = visible
    .flatMap((a) => {
      if (a.status !== "FIRING") return [];
      const snap = parseOwnershipSnapshot(a.ownershipSnapshot);
      if (!snap || a.escalationStep >= snap.order.length) return [];
      const base = a.escalatedAt ?? new Date(snap.capturedAt);
      const dueAt = new Date(new Date(base).getTime() + ackMinutes * 60_000);
      return [
        {
          id: a.id,
          title: a.title,
          waitingOn: snap.order[a.escalationStep - 1]?.name ?? "?",
          next: snap.order[a.escalationStep],
          step: a.escalationStep + 1,
          dueAt,
          progress: Math.min(
            Math.max(
              (now.getTime() - new Date(base).getTime()) / (ackMinutes * 60_000),
              0,
            ),
            1,
          ),
        },
      ];
    })
    .sort((x, y) => x.dueAt.getTime() - y.dueAt.getTime())
    .slice(0, 2);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[27px] font-semibold leading-tight tracking-[-0.025em] text-stone-900">
            알람 대시보드
          </h1>
          <p className="mt-1.5 text-sm text-stone-500">
            웹훅으로 수신한 발화 알람 · 핑거프린트 기준 중복 제거
          </p>
        </div>
        {firingVisible.length > 0 && !readOnly && (
          <form action={bulkAckAlerts}>
            <input
              type="hidden"
              name="ids"
              value={firingVisible.map((a) => a.id).join(",")}
            />
            <input type="hidden" name="back" value={dashboardHref(f)} />
            <PendingButton
              pendingLabel="Ack 처리 중…"
              title="현재 필터 결과의 FIRING 알람을 모두 Ack합니다"
              className="inline-flex h-8 items-center border border-stone-900 bg-stone-900 px-[15px] text-sm font-semibold text-white transition-colors hover:bg-black"
            >
              일괄 Ack ({firingVisible.length})
            </PendingButton>
          </form>
        )}
      </div>

      {unmappedCount > 0 && !f.unmapped && (
        <div className="flex items-center gap-3 border border-stone-200 border-l-[3px] border-l-[#b54708] bg-white px-4 py-3">
          <span className="font-mono text-[11px] font-bold tracking-[0.07em] text-[#b54708]">
            주의
          </span>
          <p className="text-sm font-semibold text-stone-900">
            미매핑 AWS 계정 알람 {unmappedCount}건
          </p>
          <p className="hidden text-sm text-stone-500 sm:block">
            담당자 없이 수신된 알람입니다 — 계정을 서비스에 매핑하면 담당 해석이
            적용됩니다.
          </p>
          <Link
            href={dashboardHref({ ...f, unmapped: true })}
            className="ml-auto shrink-0 text-sm font-semibold text-indigo-600 hover:underline"
          >
            미매핑만 보기 →
          </Link>
        </div>
      )}

      {f.unmapped && (
        <div className="flex items-center gap-3 border border-stone-200 border-l-[3px] border-l-[#b54708] bg-white px-4 py-3">
          <span className="font-mono text-[11px] font-bold tracking-[0.07em] text-[#b54708]">
            주의
          </span>
          <p className="text-sm text-stone-600">
            미매핑 계정의 알람만 보고 있습니다. 각 행의 ⚠ 매핑 필요를 누르면 그
            자리에서 서비스에 매핑할 수 있습니다.
          </p>
          <Link
            href={dashboardHref({ ...f, unmapped: false })}
            className="ml-auto shrink-0 text-sm font-semibold text-indigo-600 hover:underline"
          >
            전체 보기 →
          </Link>
        </div>
      )}

      <StatCards
        stats={stats}
        hrefs={{
          firing: toggleStatus("FIRING"),
          acknowledged: toggleStatus("ACKNOWLEDGED"),
          resolved: toggleStatus("RESOLVED"),
          insufficient: toggleStatus("INSUFFICIENT_DATA"),
          total: dashboardHref({ ...f, statuses: [] }),
        }}
        activeKeys={f.statuses.map((s) =>
          s === "FIRING"
            ? "firing"
            : s === "ACKNOWLEDGED"
              ? "acknowledged"
              : s === "RESOLVED"
                ? "resolved"
                : "insufficient",
        )}
      />

      {/* 필터 바 — GET form이라 JS 없이 동작. 상태·담당 토글은 링크라서 폼
          제출 시 hidden으로 함께 보존한다. v2: 한 장의 카드 안에 조직 필터
          줄과 상태 칩 줄이 헤어라인으로 나뉜다. */}
      <div className="space-y-3.5 border border-stone-200 bg-white p-4">
        <form
          method="get"
          action="/"
          className="flex flex-wrap items-center gap-1.5 text-sm"
        >
          {f.statuses.length > 0 && (
            <input type="hidden" name="status" value={f.statuses.join(",")} />
          )}
          {f.assignee && <input type="hidden" name="assignee" value={f.assignee} />}
          {f.unmapped && <input type="hidden" name="unmapped" value="1" />}
          <AutoSubmitSelect
            name="customer"
            aria-label="고객사"
            defaultValue={f.customer ?? ""}
            className={filterControl}
          >
            <option value="">전체 고객사</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </AutoSubmitSelect>
          <AutoSubmitSelect
            name="project"
            aria-label="프로젝트"
            defaultValue={f.project ?? ""}
            className={filterControl}
            title={f.customer ? undefined : "프로젝트를 고르면 고객사도 함께 좁혀집니다"}
          >
            <option value="">{f.customer ? "전체 프로젝트" : "전체 프로젝트 (모든 고객사)"}</option>
            {f.customer
              ? projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              : customers.map((c) => {
                  const mine = projects.filter((p) => p.customerId === c.id);
                  if (!mine.length) return null;
                  return (
                    <optgroup key={c.id} label={c.name}>
                      {mine.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
          </AutoSubmitSelect>
          <AutoSubmitSelect
            name="env"
            aria-label="환경"
            defaultValue={f.env ?? ""}
            className={filterControl}
          >
            <option value="">전체 환경</option>
            {envs.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </AutoSubmitSelect>
          <input
            type="search"
            name="q"
            aria-label="검색"
            defaultValue={f.q ?? ""}
            placeholder="검색 (제목·리소스·메트릭·계정)"
            className="w-56 h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400"
          />
          <button
            title="드롭다운은 고르는 즉시 적용됩니다 — 검색어는 Enter 또는 이 버튼"
            className="inline-flex h-8 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50"
          >
            적용
          </button>
        </form>

        <div className="h-px bg-stone-100" />

        <div className="flex flex-wrap items-center gap-[7px]">
          <span className="mr-1 font-mono text-[11px] font-bold tracking-[0.07em] text-stone-400">
            STATUS
          </span>
          {STATUS_CHIPS.map((c) => {
            const active = f.statuses.includes(c.value);
            const tone = statusTone(c.value);
            const count =
              c.value === "FIRING"
                ? stats.firing
                : c.value === "ACKNOWLEDGED"
                  ? stats.acknowledged
                  : c.value === "RESOLVED"
                    ? stats.resolved
                    : stats.insufficient;
            return (
              <Link
                key={c.value}
                href={toggleStatus(c.value)}
                aria-pressed={active}
                className={`inline-flex h-[26px] items-center gap-[7px] border px-[11px] text-xs transition-colors ${
                  active
                    ? "border-stone-900 bg-stone-100 font-semibold text-stone-900"
                    : "border-stone-200 bg-white font-medium text-stone-500 hover:border-stone-400"
                }`}
              >
                <Mark
                  color={active ? tone.color : "#c9c4b8"}
                  shape={tone.shape}
                />
                {c.label}
                <span
                  className={`font-mono text-xs font-bold ${
                    active ? "text-stone-600" : "text-stone-400"
                  }`}
                >
                  {count}
                </span>
              </Link>
            );
          })}
          {anyFilterActive(f) && (
            <Link
              href="/"
              className="ml-1 text-xs font-medium text-indigo-600 hover:underline"
            >
              ✕ 초기화
            </Link>
          )}
          <span className="ml-auto text-xs text-stone-500">
            필터 결과{" "}
            <span className="font-mono font-bold text-stone-900">
              {visible.length}
            </span>{" "}
            / 전체 <span className="font-mono">{rows.length}</span>
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          <AlertTable
            alerts={visible}
            ownership={ownership}
            filtered={anyFilterActive(f)}
            backHref={dashboardHref(f)}
            muted={mutedById}
          />
        </div>

        <aside className="w-full shrink-0 lg:w-72">
          <div className="border border-stone-200 bg-white">
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
              <h2 className="font-mono text-[11px] font-bold tracking-[0.07em] text-stone-400">
                담당 인원 · P1
              </h2>
              <span className="font-mono text-xs text-stone-400">
                {panelBase.length}
              </span>
            </div>
            {panel.length === 0 ? (
              <p className="px-4 py-3 text-sm text-stone-400">
                표시할 알람이 없습니다.
              </p>
            ) : (
              <ul>
                {panel.map((p) => {
                  const active = f.assignee === p.id;
                  const unassigned = p.id === UNASSIGNED;
                  return (
                    <li key={p.id}>
                      <Link
                        href={toggleAssignee(p.id)}
                        aria-pressed={active}
                        className={`flex items-center gap-[11px] border-b border-stone-100 px-4 py-3 transition-colors ${
                          active
                            ? "bg-stone-50 shadow-[inset_2px_0_0_#1b1a17]"
                            : "hover:bg-stone-50"
                        }`}
                      >
                        <span
                          className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center border text-xs font-semibold ${
                            active
                              ? "border-stone-900 bg-stone-900 text-white"
                              : "border-stone-200 bg-white text-stone-500"
                          }`}
                        >
                          {unassigned ? "—" : p.name.charAt(0)}
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${
                            active
                              ? "font-semibold text-stone-900"
                              : unassigned
                                ? "text-stone-400"
                                : "font-medium text-stone-900"
                          }`}
                        >
                          {p.name}
                        </span>
                        <span
                          className="block h-[3px]"
                          style={{
                            width: `${Math.min(p.count, 6) * 14}px`,
                            background: active ? "#1b1a17" : "#ded9cf",
                          }}
                        />
                        <span className="min-w-4 text-right font-mono text-sm font-bold text-stone-900">
                          {p.count}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="px-4 py-2.5 text-xs text-stone-400">
              이름을 눌러 담당자 기준으로 필터
            </p>
          </div>

          {escalationQueue.length > 0 && (
            <div className="mt-[18px] border border-stone-200 bg-white">
              <div className="border-b border-stone-200 px-4 py-3">
                <h2 className="font-mono text-[11px] font-bold tracking-[0.07em] text-stone-400">
                  에스컬레이션 대기
                </h2>
              </div>
              <div className="flex flex-col gap-4 px-4 py-3.5">
                {escalationQueue.map((e) => {
                  const remainMs = e.dueAt.getTime() - now.getTime();
                  const remain =
                    remainMs <= 0
                      ? "다음 틱에 통지"
                      : `T-${Math.floor(remainMs / 60_000)}:${String(
                          Math.floor((remainMs % 60_000) / 1000),
                        ).padStart(2, "0")}`;
                  return (
                    <div key={e.id} className="flex flex-col gap-2.5">
                      <div className="flex items-baseline justify-between gap-2.5">
                        <Link
                          href={`/alerts/${e.id}`}
                          className="truncate text-sm font-medium text-stone-900 hover:text-indigo-600 hover:underline"
                        >
                          {e.title}
                        </Link>
                        <span className="whitespace-nowrap font-mono text-xs font-bold text-[#b54708]">
                          {remain}
                        </span>
                      </div>
                      <div className="text-xs leading-relaxed text-stone-500">
                        {e.waitingOn} 미응답 → {e.step}순위 {e.next.name}
                        {e.next.department ? `(${e.next.department})` : ""} 자동 통지
                      </div>
                      <div className="h-[3px] bg-stone-100">
                        <span
                          className="block h-full bg-[#b54708]"
                          style={{ width: `${Math.round(e.progress * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
