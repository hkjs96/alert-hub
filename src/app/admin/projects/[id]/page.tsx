import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createService, deleteService } from "@/server/org-actions";
import { AssignmentEditor } from "@/components/admin/assignment-editor";
import { Roster } from "@/components/admin/roster";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const project = await prisma.project.findUnique({
    where: { id: params.id },
    include: { customer: true, services: { include: { accounts: true } } },
  });
  if (!project) notFound();
  const back = `/admin/projects/${project.id}`;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-stone-400">
          <Link href="/admin/customers" className="hover:underline">
            고객사
          </Link>{" "}
          /{" "}
          <Link href={`/admin/customers/${project.customerId}`} className="hover:underline">
            {project.customer.name}
          </Link>{" "}
          / {project.name}
        </div>
        <h1 className="text-xl font-semibold text-stone-900">{project.name}</h1>
      </div>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-stone-700">
          프로젝트 담당 <span className="font-normal text-stone-400">(서비스에 별도 지정 없으면 여기로 상속)</span>
        </h2>
        <AssignmentEditor
          level="project"
          scopeId={project.id}
          customerId={project.customerId}
          back={back}
        />
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-stone-700">서비스</h2>
        <form action={createService} className="mb-3 flex flex-wrap gap-2 text-sm">
          <input type="hidden" name="projectId" value={project.id} />
          <input type="hidden" name="back" value={back} />
          <input
            name="name"
            required
            placeholder="서비스 이름"
            className="rounded-md border border-stone-300 px-2 py-1"
          />
          <button className="rounded-md bg-stone-900 px-3 py-1 text-white hover:bg-stone-700">
            + 서비스
          </button>
        </form>
        <ul className="divide-y divide-stone-100 text-sm">
          {project.services.map((s: any) => (
            <li key={s.id} className="flex items-center gap-2 py-2">
              <Link
                href={`/admin/services/${s.id}`}
                className="font-medium text-stone-900 hover:text-indigo-600 hover:underline"
              >
                {s.name}
              </Link>
              <span className="text-stone-400">계정 {s.accounts.length}개</span>
              <form action={deleteService} className="ml-auto inline">
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="back" value={back} />
                <button className="text-xs text-stone-400 hover:text-red-600">삭제</button>
              </form>
            </li>
          ))}
          {project.services.length === 0 && (
            <li className="py-3 text-stone-400">서비스가 없습니다.</li>
          )}
        </ul>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-stone-700">
          관련 인원 전체 <span className="font-normal text-stone-400">(하위 포함 롤업)</span>
        </h2>
        <Roster level="project" id={project.id} />
      </section>
    </div>
  );
}
