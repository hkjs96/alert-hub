import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createAccountMap, deleteAccountMap } from "@/server/org-actions";
import { AssignmentEditor } from "@/components/admin/assignment-editor";
import { Roster } from "@/components/admin/roster";

export const dynamic = "force-dynamic";

export default async function ServiceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const service = await prisma.service.findUnique({
    where: { id: params.id },
    include: {
      project: { include: { customer: true } },
      accounts: true,
    },
  });
  if (!service) notFound();
  const back = `/admin/services/${service.id}`;
  const customerId = service.project.customerId;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-stone-400">
          <Link href="/admin/customers" className="hover:underline">
            고객사
          </Link>{" "}
          /{" "}
          <Link href={`/admin/customers/${customerId}`} className="hover:underline">
            {service.project.customer.name}
          </Link>{" "}
          /{" "}
          <Link href={`/admin/projects/${service.projectId}`} className="hover:underline">
            {service.project.name}
          </Link>{" "}
          / {service.name}
        </div>
        <h1 className="text-xl font-semibold text-stone-900">{service.name}</h1>
      </div>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-stone-700">
          서비스 담당 <span className="font-normal text-stone-400">(프로젝트 담당을 오버라이드)</span>
        </h2>
        <AssignmentEditor
          level="service"
          scopeId={service.id}
          customerId={customerId}
          back={back}
        />
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-stone-700">AWS 계정 매핑</h2>
        <p className="mb-3 text-xs text-stone-400">
          알람의 AlarmArn에서 추출된 accountId가 여기 매칭되어 고객사/프로젝트/담당이 결정됩니다.
        </p>
        <form action={createAccountMap} className="mb-3 flex flex-wrap gap-2 text-sm">
          <input type="hidden" name="serviceId" value={service.id} />
          <input type="hidden" name="back" value={back} />
          <input
            name="accountId"
            required
            pattern="\d{12}"
            placeholder="123456789012"
            className="w-36 rounded-md border border-stone-300 px-2 py-1 font-mono"
          />
          <input
            name="alias"
            placeholder="별칭 (선택)"
            className="rounded-md border border-stone-300 px-2 py-1"
          />
          <select
            name="environment"
            className="rounded-md border border-stone-300 bg-white px-2 py-1"
            defaultValue=""
          >
            <option value="">환경 (선택)</option>
            <option value="prd">prd</option>
            <option value="stg">stg</option>
            <option value="dev">dev</option>
          </select>
          <button className="rounded-md bg-stone-900 px-3 py-1 text-white hover:bg-stone-700">
            + 계정 매핑
          </button>
        </form>

        <ul className="divide-y divide-stone-100 text-sm">
          {service.accounts.map((a: any) => (
            <li key={a.id} className="space-y-2 py-3">
              <div className="flex items-center gap-2">
                <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs">
                  {a.accountId}
                </code>
                {a.alias ? <span className="text-stone-700">{a.alias}</span> : null}
                {a.environment ? (
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                    {a.environment}
                  </span>
                ) : null}
                <form action={deleteAccountMap} className="ml-auto inline">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="back" value={back} />
                  <button className="text-xs text-stone-400 hover:text-red-600">삭제</button>
                </form>
              </div>
              <div className="pl-1">
                <div className="mb-1 text-xs text-stone-400">
                  계정 레벨 담당 (서비스 담당을 오버라이드)
                </div>
                <AssignmentEditor
                  level="account"
                  scopeId={a.id}
                  customerId={customerId}
                  back={back}
                />
              </div>
            </li>
          ))}
          {service.accounts.length === 0 && (
            <li className="py-3 text-stone-400">매핑된 계정이 없습니다.</li>
          )}
        </ul>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-stone-700">
          관련 인원 전체 <span className="font-normal text-stone-400">(계정 포함 롤업)</span>
        </h2>
        <Roster level="service" id={service.id} />
      </section>
    </div>
  );
}
