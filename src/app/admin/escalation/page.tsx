import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  getContactChoices,
  getContactsByIds,
  getDirectAssignments,
  getInheritedOrder,
} from "@/server/org";
import { addAssignment, moveAssignment, removeAssignment } from "@/server/org-actions";

export const dynamic = "force-dynamic";

type Level = "customer" | "project" | "service";

const LEVEL_TABS: { level: Level; label: string }[] = [
  { level: "customer", label: "고객사 담당" },
  { level: "project", label: "프로젝트 담당" },
  { level: "service", label: "서비스 담당" },
];

function isLevel(v: string | undefined): v is Level {
  return v === "customer" || v === "project" || v === "service";
}

/**
 * 알람 처리 순서 — the notification sequence for one scope.
 *
 * Scope and level live in the query string so the page stays a plain server
 * component: every control is a link or a form post, no client JS. The scope
 * picker is a GET form because three dependent selects can't narrow each other
 * without JS; the 이동 button applies the whole selection at once.
 */
export default async function EscalationPage({
  searchParams,
}: {
  searchParams: { customerId?: string; projectId?: string; serviceId?: string; level?: string };
}) {
  const customers = await prisma.customer.findMany({ orderBy: { name: "asc" } });

  if (customers.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-slate-900">알람 처리 순서</h1>
        <p className="text-sm text-slate-400">
          아직 고객사가 없습니다.{" "}
          <Link href="/admin/customers" className="underline hover:text-blue-600">
            조직 · 담당자 관리
          </Link>
          에서 먼저 등록하세요.
        </p>
      </div>
    );
  }

  const customer =
    customers.find((c) => c.id === searchParams.customerId) ?? customers[0];

  const projects = await prisma.project.findMany({
    where: { customerId: customer.id },
    orderBy: { name: "asc" },
  });
  const project =
    projects.find((p) => p.id === searchParams.projectId) ?? projects[0] ?? null;

  const services = project
    ? await prisma.service.findMany({
        where: { projectId: project.id },
        orderBy: { name: "asc" },
      })
    : [];
  const service =
    services.find((s) => s.id === searchParams.serviceId) ?? services[0] ?? null;

  // Fall back to a level that actually exists in this scope.
  let level: Level = isLevel(searchParams.level) ? searchParams.level : "service";
  if (level === "service" && !service) level = project ? "project" : "customer";
  if (level === "project" && !project) level = "customer";

  const scopeId =
    level === "customer" ? customer.id : level === "project" ? project!.id : service!.id;
  const scopeName =
    level === "customer"
      ? `${customer.name} 고객사`
      : level === "project"
        ? `${project!.name} 프로젝트`
        : `${service!.name} 서비스`;

  const query = (over: Partial<Record<string, string>> = {}) => {
    const params = new URLSearchParams({
      customerId: customer.id,
      ...(project ? { projectId: project.id } : {}),
      ...(service ? { serviceId: service.id } : {}),
      level,
      ...over,
    });
    return `/admin/escalation?${params.toString()}`;
  };
  const back = query();

  const [assignments, choices] = await Promise.all([
    getDirectAssignments(level, scopeId),
    getContactChoices(customer.id),
  ]);

  const inherited =
    assignments.length === 0
      ? await getInheritedOrder(level, {
          customerId: customer.id,
          projectId: project?.id,
        })
      : null;
  const inheritedContacts = inherited ? await getContactsByIds(inherited.order) : [];

  const registered = new Set(assignments.map((a) => a.contactId));
  const available = choices.filter((c) => !registered.has(c.id));

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">알람 처리 순서</h1>
        <p className="mt-1 text-sm text-slate-500">
          각 단계에 등록된 담당자를 알람이 통지되는 순서대로 정렬합니다. 순서 1번이
          가장 먼저 통지됩니다. 담당자 등록 자체는{" "}
          <Link href="/admin/customers" className="underline hover:text-blue-600">
            조직 · 담당자 관리
          </Link>
          에서 합니다.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-1.5 text-sm">
        <input type="hidden" name="level" value={level} />
        <select
          name="customerId"
          aria-label="고객사"
          defaultValue={customer.id}
          className="rounded-md border border-slate-300 bg-white px-2 py-1"
        >
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="text-slate-300">/</span>
        <select
          name="projectId"
          aria-label="프로젝트"
          defaultValue={project?.id ?? ""}
          disabled={projects.length === 0}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 disabled:text-slate-300"
        >
          {projects.length === 0 && <option value="">프로젝트 없음</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="text-slate-300">/</span>
        <select
          name="serviceId"
          aria-label="서비스"
          defaultValue={service?.id ?? ""}
          disabled={services.length === 0}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 font-medium disabled:font-normal disabled:text-slate-300"
        >
          {services.length === 0 && <option value="">서비스 없음</option>}
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="rounded-md border border-slate-300 px-2.5 py-1 hover:bg-slate-50">
          이동
        </button>
      </form>

      <div className="flex w-fit gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        {LEVEL_TABS.map((t) => {
          const disabled =
            (t.level === "project" && !project) || (t.level === "service" && !service);
          const active = t.level === level;
          if (disabled) {
            return (
              <span
                key={t.level}
                className="cursor-not-allowed rounded-md px-3 py-1 text-slate-300"
              >
                {t.label}
              </span>
            );
          }
          return (
            <Link
              key={t.level}
              href={query({ level: t.level })}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-md bg-white px-3 py-1 font-medium text-slate-900 shadow-sm"
                  : "rounded-md px-3 py-1 text-slate-500 hover:text-slate-900"
              }
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">{scopeName} 처리 순서</h2>
        <p className="mb-3 text-xs text-slate-400">
          이 단계에 직접 등록된 담당자의 알람 통지 순서입니다.
        </p>

        {assignments.length === 0 && (
          <p className="py-2 text-sm text-slate-400">
            이 단계에 직접 등록된 담당자가 없습니다.
          </p>
        )}

        {inherited && inherited.order.length > 0 && (
          <p className="mb-3 border-b border-slate-100 pb-3 text-xs text-slate-500">
            현재{" "}
            {inherited.level === "customer" ? "고객사" : "프로젝트"} 단계에서 상속된
            순서 (참고용, 이 단계에서 수정 불가):{" "}
            <span className="text-slate-700">
              {inheritedContacts.map((c) => c.name).join(" → ")}
            </span>
          </p>
        )}

        <ol className="space-y-1.5">
          {assignments.map((a, i) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-900 text-xs font-semibold tabular-nums text-white">
                {i + 1}
              </span>
              <span className="font-medium text-slate-800">{a.contact.name}</span>
              {a.contact.department ? (
                <span className="text-xs text-slate-400">{a.contact.department}</span>
              ) : null}

              <span className="ml-auto flex items-center gap-1">
                <form action={moveAssignment} className="inline">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="direction" value="up" />
                  <input type="hidden" name="back" value={back} />
                  <button
                    aria-label={`${a.contact.name} 순서 올리기`}
                    disabled={i === 0}
                    className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs disabled:opacity-40"
                  >
                    ↑
                  </button>
                </form>
                <form action={moveAssignment} className="inline">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="direction" value="down" />
                  <input type="hidden" name="back" value={back} />
                  <button
                    aria-label={`${a.contact.name} 순서 내리기`}
                    disabled={i === assignments.length - 1}
                    className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs disabled:opacity-40"
                  >
                    ↓
                  </button>
                </form>
                <form action={removeAssignment} className="inline">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="back" value={back} />
                  <button
                    aria-label={`${a.contact.name} 제거`}
                    className="px-1 text-slate-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </form>
              </span>
            </li>
          ))}
        </ol>

        {available.length > 0 && (
          <form
            action={addAssignment}
            className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 text-sm"
          >
            <input type="hidden" name="level" value={level} />
            <input type="hidden" name="scopeId" value={scopeId} />
            <input type="hidden" name="back" value={back} />
            <select
              name="contactId"
              required
              aria-label="담당자 추가"
              defaultValue=""
              className="rounded-md border border-slate-300 bg-white px-2 py-1"
            >
              <option value="" disabled>
                담당자 추가 (맨 뒤 순번으로)…
              </option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.department ? ` (${c.department})` : ""}
                  {c.customerId === null ? " · 내부" : ""}
                </option>
              ))}
            </select>
            <button className="rounded-md bg-slate-900 px-2.5 py-1 text-white hover:bg-slate-700">
              + 추가
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
