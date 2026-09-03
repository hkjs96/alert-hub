import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  createAccountMap,
  createProject,
  createService,
  createTeam,
} from "@/server/org-actions";
import { AssignmentEditor } from "@/components/admin/assignment-editor";
import { CoverageBadge } from "@/components/admin/coverage-badge";
import { ContactRoster } from "@/components/admin/contact-roster";
import { TeamEditor } from "@/components/admin/team-editor";
import { RoutingRulesEditor } from "@/components/admin/routing-rules";
import { PendingButton } from "@/components/pending-button";

export const dynamic = "force-dynamic";

// O1: 조직 · 담당자 관리의 마스터-디테일 단일 화면. 좌측에 전체 트리
// (고객사 › 프로젝트 › 서비스 › 계정)가 커버리지 배지와 함께 펼쳐지고,
// 우측에서 선택한 스코프의 담당 등록·하위 생성·계정 매핑을 그 자리에서
// 처리한다 — 기존 3단 페이지 왕복을 없앤다. 선택은 쿼리 파라미터라 JS 없이
// 동작하고, 기존 상세 페이지들은 딥링크로 계속 쓸 수 있다.

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";
const overline =
  "font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400";
const primaryBtn =
  "inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700";

type Level = "customer" | "project" | "service";

function isLevel(v: string | undefined): v is Level {
  return v === "customer" || v === "project" || v === "service";
}

export default async function OrgPage({
  searchParams,
}: {
  searchParams: { level?: string; id?: string };
}) {
  const [customers, assignments] = await Promise.all([
    prisma.customer.findMany({
      orderBy: { name: "asc" },
      include: {
        teams: { orderBy: { name: "asc" } },
        projects: {
          orderBy: { name: "asc" },
          include: {
            services: {
              orderBy: { name: "asc" },
              include: { accounts: { orderBy: { accountId: "asc" } } },
            },
          },
        },
      },
    }),
    prisma.assignment.findMany({
      select: { customerId: true, projectId: true, serviceId: true },
    }),
  ]);

  // 스코프별 직접 등록 인원 수 — 트리의 커버리지 배지용.
  const counts = new Map<string, number>();
  for (const a of assignments) {
    const key = a.customerId ?? a.projectId ?? a.serviceId;
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const direct = (id: string) => counts.get(id) ?? 0;

  // 선택 해석 — 기본은 첫 고객사.
  const level: Level = isLevel(searchParams.level) ? searchParams.level : "customer";
  const selId = searchParams.id;

  let selected:
    | { level: "customer"; customer: (typeof customers)[number] }
    | {
        level: "project";
        customer: (typeof customers)[number];
        project: (typeof customers)[number]["projects"][number];
      }
    | {
        level: "service";
        customer: (typeof customers)[number];
        project: (typeof customers)[number]["projects"][number];
        service: (typeof customers)[number]["projects"][number]["services"][number];
      }
    | null = null;

  for (const c of customers) {
    if (level === "customer" && c.id === selId) selected = { level: "customer", customer: c };
    for (const p of c.projects) {
      if (level === "project" && p.id === selId)
        selected = { level: "project", customer: c, project: p };
      for (const s of p.services) {
        if (level === "service" && s.id === selId)
          selected = { level: "service", customer: c, project: p, service: s };
      }
    }
  }
  if (!selected && customers.length > 0) {
    selected = { level: "customer", customer: customers[0] };
  }

  const selectedScopeId = !selected
    ? null
    : selected.level === "customer"
      ? selected.customer.id
      : selected.level === "project"
        ? selected.project.id
        : selected.service.id;
  const href = (lv: Level, id: string) => `/admin/org?level=${lv}&id=${id}`;
  const back =
    selected && selectedScopeId ? href(selected.level, selectedScopeId) : "/admin/org";

  const nodeClass = (active: boolean) =>
    `flex items-center gap-2 px-2 py-1 text-sm transition-colors ${
      active
        ? "bg-stone-100 font-semibold text-stone-900 shadow-[inset_2px_0_0_#1b1a17]"
        : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
    }`;

  return (
    <div className="space-y-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-stone-900">
            조직 · 담당자 관리
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            왼쪽 트리에서 스코프를 고르면 그 자리에서 담당 등록·하위 생성·계정
            매핑까지 처리합니다. ⚠ 미지정은 알람이 담당자 없이 수신되는 스코프.
          </p>
        </div>
        <Link
          href="/admin/onboard"
          className="inline-flex h-8 items-center border border-stone-900 bg-stone-900 px-[15px] text-sm font-semibold text-white transition-colors hover:bg-black"
        >
          + 새 고객사 온보딩
        </Link>
      </div>

      {customers.length === 0 ? (
        <p className="border border-stone-200 bg-white p-6 text-sm text-stone-400">
          아직 고객사가 없습니다 —{" "}
          <Link href="/admin/onboard" className="text-indigo-600 underline">
            새 고객사 온보딩
          </Link>
          으로 시작하세요.
        </p>
      ) : (
        <div className="flex flex-col gap-[18px] lg:flex-row lg:items-start">
          {/* ---- 좌: 조직 트리 ---- */}
          <div className="w-full shrink-0 border border-stone-200 bg-white lg:w-[360px]">
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
              <h2 className={overline}>조직 트리</h2>
              <Link
                href="/admin/customers"
                className="text-xs text-stone-400 hover:text-stone-900"
              >
                고객사 목록 ↗
              </Link>
            </div>
            <div className="space-y-3 px-2 py-3">
              {customers.map((c) => (
                <div key={c.id}>
                  <Link
                    href={href("customer", c.id)}
                    className={nodeClass(
                      selected?.level === "customer" && selected.customer.id === c.id,
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {c.name}
                      {c.isInternal ? (
                        <span className="ml-1.5 text-[11px] text-stone-400">내부</span>
                      ) : null}
                    </span>
                    <CoverageBadge direct={direct(c.id)} inheritedFrom={null} />
                  </Link>
                  {c.projects.map((p) => (
                    <div key={p.id} className="ml-3 border-l border-stone-100 pl-2">
                      <Link
                        href={href("project", p.id)}
                        className={nodeClass(
                          selected?.level === "project" && selected.project.id === p.id,
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        <CoverageBadge
                          direct={direct(p.id)}
                          inheritedFrom={direct(c.id) > 0 ? "고객사" : null}
                        />
                      </Link>
                      {p.services.map((s) => (
                        <div key={s.id} className="ml-3 border-l border-stone-100 pl-2">
                          <Link
                            href={href("service", s.id)}
                            className={nodeClass(
                              selected?.level === "service" &&
                                selected.service.id === s.id,
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate">{s.name}</span>
                            <span className="font-mono text-[11px] text-stone-400">
                              계정 {s.accounts.length}
                            </span>
                            <CoverageBadge
                              direct={direct(s.id)}
                              inheritedFrom={
                                direct(p.id) > 0
                                  ? "프로젝트"
                                  : direct(c.id) > 0
                                    ? "고객사"
                                    : null
                              }
                            />
                          </Link>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* ---- 우: 선택 스코프 상세 ---- */}
          {selected && (
            <div className="min-w-0 flex-1 space-y-[18px]">
              <section className="border border-stone-200 bg-white">
                <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-5 py-3">
                  <h2 className={overline}>
                    {selected.level === "customer"
                      ? "고객사"
                      : selected.level === "project"
                        ? "프로젝트"
                        : "서비스"}
                  </h2>
                  <span className="text-sm font-semibold text-stone-900">
                    {selected.level === "customer"
                      ? selected.customer.name
                      : selected.level === "project"
                        ? `${selected.customer.name} › ${selected.project.name}`
                        : `${selected.customer.name} › ${selected.project.name} › ${selected.service.name}`}
                  </span>
                  <span className="ml-auto flex gap-3 text-xs">
                    <Link
                      href={
                        selected.level === "customer"
                          ? `/admin/customers/${selected.customer.id}`
                          : selected.level === "project"
                            ? `/admin/projects/${selected.project.id}`
                            : `/admin/services/${selected.service.id}`
                      }
                      className="text-stone-400 hover:text-stone-900"
                    >
                      상세 페이지 ↗
                    </Link>
                    <Link
                      href={`/admin/escalation?customerId=${selected.customer.id}${
                        selected.level !== "customer"
                          ? `&projectId=${selected.project.id}`
                          : ""
                      }${
                        selected.level === "service"
                          ? `&serviceId=${selected.service.id}`
                          : ""
                      }&level=${selected.level}`}
                      className="text-indigo-600 hover:underline"
                    >
                      알람 처리 순서 →
                    </Link>
                  </span>
                </div>
                <div className="p-5">
                  <div className={`mb-2 ${overline}`}>
                    담당 등록{" "}
                    <span className="font-normal normal-case tracking-normal">
                      (하위에 별도 지정이 없으면 이 순서가 상속됩니다)
                    </span>
                  </div>
                  <AssignmentEditor
                    level={selected.level}
                    scopeId={selectedScopeId!}
                    customerId={selected.customer.id}
                    back={back}
                  />
                </div>
              </section>

              {selected.level === "customer" && (
                <>
                  <section className="border border-stone-200 bg-white">
                    <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
                      <h2 className={overline}>이 고객사의 팀</h2>
                      <form action={createTeam} className="flex items-center gap-1.5 text-sm">
                        <input type="hidden" name="customerId" value={selected.customer.id} />
                        <input type="hidden" name="back" value={back} />
                        <input name="name" required placeholder="예) 결제 도메인 온콜" className={`${control} w-44`} />
                        <PendingButton pendingLabel="생성 중…" className="inline-flex h-8 items-center rounded-md border border-stone-900 bg-white px-3 text-sm font-medium text-stone-900 transition-colors hover:bg-stone-100">
                          + 팀
                        </PendingButton>
                      </form>
                    </div>
                    {selected.customer.teams.length === 0 ? (
                      <p className="px-5 py-3 text-xs text-stone-400">
                        고객사 전용 팀이 없습니다. 도메인·기능 단위로 온콜을 돌면 팀을 만들어 서비스마다 붙이세요 —
                        내부 공용 팀은 팀 · 내부 인원에서 만듭니다.
                      </p>
                    ) : (
                      <ul className="divide-y divide-stone-100">
                        {selected.customer.teams.map((t) => (
                          <li key={t.id} className="px-5 py-4">
                            <TeamEditor teamId={t.id} back={back} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <RoutingRulesEditor customerId={selected.customer.id} back={back} />

                  <section>
                    <div className={`mb-2 ${overline}`}>이 고객사의 담당자</div>
                    <ContactRoster scope={{ customerId: selected.customer.id }} back={back} />
                  </section>
                </>
              )}

              {selected.level === "customer" && (
                <section className="border border-stone-200 bg-white p-5">
                  <div className={`mb-2 ${overline}`}>새 프로젝트</div>
                  <form action={createProject} className="flex flex-wrap gap-2 text-sm">
                    <input type="hidden" name="customerId" value={selected.customer.id} />
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="redirectTo" value="/admin/org?level=project&id=__ID__" />
                    <input name="name" required placeholder="프로젝트 이름" className={control} />
                    <PendingButton pendingLabel="추가 중…" className={primaryBtn}>
                      + 프로젝트
                    </PendingButton>
                  </form>
                </section>
              )}

              {selected.level === "project" && (
                <section className="border border-stone-200 bg-white p-5">
                  <div className={`mb-2 ${overline}`}>새 서비스</div>
                  <form action={createService} className="flex flex-wrap gap-2 text-sm">
                    <input type="hidden" name="projectId" value={selected.project.id} />
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="redirectTo" value="/admin/org?level=service&id=__ID__" />
                    <input name="name" required placeholder="서비스 이름" className={control} />
                    <PendingButton pendingLabel="추가 중…" className={primaryBtn}>
                      + 서비스
                    </PendingButton>
                  </form>
                </section>
              )}

              {selected.level === "service" && (
                <section className="border border-stone-200 bg-white">
                  <div className="border-b border-stone-200 px-5 py-3">
                    <h2 className={overline}>AWS 계정 매핑</h2>
                  </div>
                  <div className="space-y-3 p-5 text-sm">
                    {selected.service.accounts.length === 0 ? (
                      <p className="text-stone-400">
                        매핑된 계정이 없습니다 — 이 서비스의 알람을 받으려면 AWS
                        계정을 매핑하세요.
                      </p>
                    ) : (
                      <ul className="divide-y divide-stone-100">
                        {selected.service.accounts.map((a) => (
                          <li key={a.id} className="flex items-center gap-3 py-2">
                            <span className="font-mono text-sm text-stone-900">
                              {a.accountId}
                            </span>
                            {a.alias ? (
                              <span className="text-sm text-stone-500">{a.alias}</span>
                            ) : null}
                            {a.environment ? (
                              <span className="font-mono text-xs uppercase tracking-[0.04em] text-stone-500">
                                {a.environment}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    <form
                      action={createAccountMap}
                      className="flex flex-wrap items-end gap-2 border-t border-stone-100 pt-3"
                    >
                      <input type="hidden" name="serviceId" value={selected.service.id} />
                      <input type="hidden" name="back" value={back} />
                      <label className="block">
                        <span className={`mb-1 block ${overline}`}>계정 ID (12자리)</span>
                        <input
                          name="accountId"
                          required
                          pattern="\d{12}"
                          inputMode="numeric"
                          className={`${control} w-40 font-mono`}
                        />
                      </label>
                      <label className="block">
                        <span className={`mb-1 block ${overline}`}>별칭 (선택)</span>
                        <input name="alias" className={`${control} w-36`} />
                      </label>
                      <label className="block">
                        <span className={`mb-1 block ${overline}`}>환경 (선택)</span>
                        <input name="environment" placeholder="prd" className={`${control} w-24`} />
                      </label>
                      <PendingButton pendingLabel="매핑 중…" className={primaryBtn}>
                        + 계정 매핑
                      </PendingButton>
                    </form>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
