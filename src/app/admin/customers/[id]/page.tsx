import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createProject, deleteProject } from "@/server/org-actions";
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
    include: { projects: { include: { services: true } } },
  });
  if (!customer) notFound();
  const back = `/admin/customers/${customer.id}`;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-400">
          <Link href="/admin/customers" className="hover:underline">
            고객사
          </Link>{" "}
          / {customer.name}
        </div>
        <h1 className="text-xl font-semibold text-slate-900">
          {customer.name}
          {customer.isInternal ? (
            <span className="ml-2 align-middle text-xs font-medium text-slate-400">
              내부
            </span>
          ) : null}
        </h1>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          고객사 레벨 담당 <span className="font-normal text-slate-400">(하위 전체의 기본값)</span>
        </h2>
        <AssignmentEditor
          level="customer"
          scopeId={customer.id}
          customerId={customer.id}
          back={back}
        />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">프로젝트</h2>
        <form action={createProject} className="mb-3 flex flex-wrap gap-2 text-sm">
          <input type="hidden" name="customerId" value={customer.id} />
          <input type="hidden" name="back" value={back} />
          <input
            name="name"
            required
            placeholder="프로젝트 이름"
            className="rounded-md border border-slate-300 px-2 py-1"
          />
          <button className="rounded-md bg-slate-900 px-3 py-1 text-white hover:bg-slate-700">
            + 프로젝트
          </button>
        </form>
        <ul className="divide-y divide-slate-100 text-sm">
          {customer.projects.map((p: any) => (
            <li key={p.id} className="flex items-center gap-2 py-2">
              <Link
                href={`/admin/projects/${p.id}`}
                className="font-medium text-slate-900 hover:text-blue-600 hover:underline"
              >
                {p.name}
              </Link>
              <span className="text-slate-400">서비스 {p.services.length}개</span>
              <form action={deleteProject} className="ml-auto inline">
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="back" value={back} />
                <button className="text-xs text-slate-400 hover:text-red-600">삭제</button>
              </form>
            </li>
          ))}
          {customer.projects.length === 0 && (
            <li className="py-3 text-slate-400">프로젝트가 없습니다.</li>
          )}
        </ul>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          관련 인원 전체 <span className="font-normal text-slate-400">(하위 포함 롤업)</span>
        </h2>
        <Roster level="customer" id={customer.id} />
      </section>
    </div>
  );
}
