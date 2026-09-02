import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createAccountMap } from "@/server/org-actions";

export const dynamic = "force-dynamic";

/**
 * 미매핑 계정 인라인 매핑 (§6.1 미매핑 배너 요구의 "행에서 인라인 매핑").
 * 대시보드의 ⚠ 매핑 필요에서 진입하는 한 가지 일만 하는 화면 — 서비스 하나를
 * 골라 매핑하고 대시보드로 돌아간다. JS 없는 서버 컴포넌트라 모달 대신
 * 전용 화면으로 푼다; 등록 관리를 헤집지 않고 그 자리에서 끝나는 게 요점이다.
 */
export default async function MapAccountPage({
  searchParams,
}: {
  searchParams: { accountId?: string; back?: string };
}) {
  const accountId = searchParams.accountId ?? "";
  const back =
    searchParams.back && searchParams.back.startsWith("/") ? searchParams.back : "/";

  const services = await prisma.service.findMany({
    include: { project: { include: { customer: true } } },
    orderBy: { name: "asc" },
  });
  services.sort((a, b) =>
    `${a.project.customer.name}/${a.project.name}/${a.name}`.localeCompare(
      `${b.project.customer.name}/${b.project.name}/${b.name}`,
    ),
  );

  const existing = /^\d{12}$/.test(accountId)
    ? await prisma.awsAccountMap.findUnique({
        where: { accountId },
        include: { service: { include: { project: { include: { customer: true } } } } },
      })
    : null;

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-stone-900">AWS 계정 매핑</h1>
        <p className="mt-1 text-sm text-stone-500">
          이 계정에서 오는 알람이 어느 서비스의 것인지 지정합니다. 매핑되는 즉시
          대시보드 필터와 담당 해석이 이 계정의 알람에도 적용됩니다.
        </p>
      </div>

      {existing ? (
        <div className="border border-stone-200 border-l-[3px] border-l-[#067647] bg-white p-4 text-sm text-stone-700">
          계정 <code className="font-mono">{existing.accountId}</code>은(는) 이미{" "}
          <span className="font-medium">
            {existing.service.project.customer.name} /{" "}
            {existing.service.project.name} / {existing.service.name}
          </span>
          에 매핑되어 있습니다.{" "}
          <Link href={back} className="underline">
            돌아가기
          </Link>
        </div>
      ) : services.length === 0 ? (
        <p className="rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-500">
          아직 서비스가 없습니다.{" "}
          <Link href="/admin/customers" className="underline hover:text-indigo-600">
            조직 · 담당자 관리
          </Link>
          에서 고객사/프로젝트/서비스를 먼저 등록하세요.
        </p>
      ) : (
        <form
          action={createAccountMap}
          className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 text-sm"
        >
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="redirectTo" value={back} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-500">
              AWS 계정 ID (12자리)
            </span>
            <input
              name="accountId"
              defaultValue={accountId}
              required
              pattern="\d{12}"
              inputMode="numeric"
              className="w-full h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400 font-mono"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-500">
              서비스
            </span>
            <select
              name="serviceId"
              required
              defaultValue=""
              className="w-full h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400"
            >
              <option value="" disabled>
                서비스 선택…
              </option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.project.customer.name} / {s.project.name} / {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="mb-1 block text-xs font-medium text-stone-500">
                별칭 (선택)
              </span>
              <input
                name="alias"
                placeholder="payment-prod"
                className="w-full h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400"
              />
            </label>
            <label className="block w-32">
              <span className="mb-1 block text-xs font-medium text-stone-500">
                환경 (선택)
              </span>
              <input
                name="environment"
                placeholder="prd"
                list="env-suggestions"
                className="w-full h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400"
              />
              <datalist id="env-suggestions">
                <option value="prd" />
                <option value="stg" />
                <option value="dev" />
              </datalist>
            </label>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700">
              매핑하고 돌아가기
            </button>
            <Link href={back} className="text-stone-500 hover:underline">
              취소
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
