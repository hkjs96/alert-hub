import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createProject, deleteProject } from "@/server/org-actions";
import { DangerDelete } from "@/components/admin/danger-delete";
import { CoverageBadge } from "@/components/admin/coverage-badge";
import { PendingButton } from "@/components/pending-button";
import { AssignmentEditor } from "@/components/admin/assignment-editor";
import { Roster } from "@/components/admin/roster";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: {
      _count: { select: { assignments: true } },
      projects: {
        include: { services: true, _count: { select: { assignments: true } } },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!customer) notFound();
  const back = `/admin/customers/${customer.id}`;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-stone-400">
          <Link href="/admin/customers" className="hover:underline">
            고객사
          </Link>{" "}
          / {customer.name}
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-stone-900">
          {customer.name}
          {customer.isInternal ? (
            <span className="ml-2 align-middle text-xs font-medium text-stone-400">
              내부
            </span>
          ) : null}
        </h1>
      </div>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">
          고객사 레벨 담당 <span className="font-normal text-stone-400">(하위 전체의 기본값)</span>
        </h2>
        <AssignmentEditor
          level="customer"
          scopeId={customer.id}
          customerId={customer.id}
          back={back}
        />
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">프로젝트</h2>
        <form action={createProject} className="mb-3 flex flex-wrap gap-2 text-sm">
          <input type="hidden" name="customerId" value={customer.id} />
          <input type="hidden" name="back" value={back} />
          <input
            name="name"
            required
            placeholder="프로젝트 이름"
            className="h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400"
          />
          <PendingButton pendingLabel="추가 중…" className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700">
            + 프로젝트
          </PendingButton>
        </form>
        <ul className="divide-y divide-stone-100 text-sm">
          {customer.projects.map((p: any) => (
            <li key={p.id} className="flex items-center gap-2 py-2">
              <Link
                href={`/admin/projects/${p.id}`}
                className="font-medium text-stone-900 hover:text-indigo-600 hover:underline"
              >
                {p.name}
              </Link>
              <span className="text-stone-400">서비스 {p.services.length}개</span>
              <CoverageBadge
                direct={p._count.assignments}
                inheritedFrom={customer._count.assignments > 0 ? "고객사" : null}
              />
              <span className="ml-auto">
                <DangerDelete
                  action={deleteProject}
                  id={p.id}
                  back={back}
                  subject={`${p.name} 프로젝트`}
                  impact={`서비스 ${p.services.length}개와 계정 매핑`}
                />
              </span>
            </li>
          ))}
          {customer.projects.length === 0 && (
            <li className="py-3 text-stone-400">프로젝트가 없습니다.</li>
          )}
        </ul>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">
          관련 인원 전체 <span className="font-normal text-stone-400">(하위 포함 롤업)</span>
        </h2>
        <Roster level="customer" id={customer.id} />
      </section>
    </div>
  );
}
