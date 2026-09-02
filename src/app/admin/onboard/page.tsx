import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  createAccountMap,
  createCustomer,
  createProject,
  createService,
} from "@/server/org-actions";
import { AssignmentEditor } from "@/components/admin/assignment-editor";
import { PendingButton } from "@/components/pending-button";

export const dynamic = "force-dynamic";

// O3: 새 고객사 온보딩 위저드. 고객사 → 프로젝트 → 서비스 → 계정 매핑 →
// 담당 등록을 한 화면에서 순서대로 밟는다. 진행 상태는 쿼리 파라미터라
// JS 없이 동작하고, 각 생성 액션의 redirectTo("__ID__" 치환)가 다음 단계로
// 넘겨 준다. 중간에 떠나도 만들어진 것은 그대로 남는다 (위저드는 흐름일 뿐,
// 상태를 소유하지 않는다).

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";
const overline =
  "font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400";
const primaryBtn =
  "inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700";

const STEPS = ["고객사", "프로젝트", "서비스", "계정 매핑", "담당 등록"];

function Steps({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {STEPS.map((label, i) => {
        const state = i < current ? "done" : i === current ? "now" : "todo";
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center font-mono text-[10px] font-bold ${
                state === "now"
                  ? "bg-stone-900 text-white"
                  : state === "done"
                    ? "border border-stone-900 text-stone-900"
                    : "border border-stone-200 text-stone-400"
              }`}
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <span
              className={`text-[13px] ${
                state === "now"
                  ? "font-semibold text-stone-900"
                  : state === "done"
                    ? "text-stone-600"
                    : "text-stone-400"
              }`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 ? (
              <span className="font-mono text-xs text-stone-300">›</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default async function OnboardPage({
  searchParams,
}: {
  searchParams: {
    customerId?: string;
    projectId?: string;
    serviceId?: string;
    mapped?: string;
  };
}) {
  const customer = searchParams.customerId
    ? await prisma.customer.findUnique({ where: { id: searchParams.customerId } })
    : null;
  const project =
    customer && searchParams.projectId
      ? await prisma.project.findUnique({ where: { id: searchParams.projectId } })
      : null;
  const service =
    project && searchParams.serviceId
      ? await prisma.service.findUnique({
          where: { id: searchParams.serviceId },
          include: { accounts: true },
        })
      : null;
  const mapped = searchParams.mapped === "1" || (service?.accounts.length ?? 0) > 0;

  const step = !customer ? 0 : !project ? 1 : !service ? 2 : !mapped ? 3 : 4;
  const qs = (over: Record<string, string> = {}) =>
    "/admin/onboard?" +
    new URLSearchParams({
      ...(customer ? { customerId: customer.id } : {}),
      ...(project ? { projectId: project.id } : {}),
      ...(service ? { serviceId: service.id } : {}),
      ...over,
    }).toString();

  return (
    <div className="max-w-3xl space-y-[18px]">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-stone-900">
          새 고객사 온보딩
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          고객사부터 담당 등록까지 한 흐름으로 — 끝나면 그 고객사의 알람이
          담당자에게 바로 흐릅니다. 중간에 나가도 만든 것은 남습니다.
        </p>
      </div>

      <Steps current={step} />

      {customer ? (
        <p className="text-[13px] text-stone-500">
          진행 중:{" "}
          <span className="font-medium text-stone-900">
            {customer.name}
            {project ? ` › ${project.name}` : ""}
            {service ? ` › ${service.name}` : ""}
          </span>
        </p>
      ) : null}

      <section className="border border-stone-200 bg-white p-5">
        {step === 0 && (
          <form action={createCustomer} className="flex flex-wrap items-end gap-3 text-sm">
            <input type="hidden" name="redirectTo" value="/admin/onboard?customerId=__ID__" />
            <label className="block">
              <span className={`mb-1 block ${overline}`}>고객사 이름</span>
              <input name="name" required placeholder="네오위즈" className={`${control} w-56`} />
            </label>
            <label className="flex h-8 items-center gap-1.5 text-stone-600">
              <input type="checkbox" name="isInternal" /> 내부(자사) 시스템
            </label>
            <PendingButton pendingLabel="생성 중…" className={primaryBtn}>
              다음 → 프로젝트
            </PendingButton>
          </form>
        )}

        {step === 1 && customer && (
          <form action={createProject} className="flex flex-wrap items-end gap-3 text-sm">
            <input type="hidden" name="customerId" value={customer.id} />
            <input
              type="hidden"
              name="redirectTo"
              value={`/admin/onboard?customerId=${customer.id}&projectId=__ID__`}
            />
            <label className="block">
              <span className={`mb-1 block ${overline}`}>프로젝트 이름</span>
              <input name="name" required placeholder="게임플랫폼" className={`${control} w-56`} />
            </label>
            <PendingButton pendingLabel="생성 중…" className={primaryBtn}>
              다음 → 서비스
            </PendingButton>
          </form>
        )}

        {step === 2 && customer && project && (
          <form action={createService} className="flex flex-wrap items-end gap-3 text-sm">
            <input type="hidden" name="projectId" value={project.id} />
            <input
              type="hidden"
              name="redirectTo"
              value={`/admin/onboard?customerId=${customer.id}&projectId=${project.id}&serviceId=__ID__`}
            />
            <label className="block">
              <span className={`mb-1 block ${overline}`}>서비스 이름</span>
              <input name="name" required placeholder="결제서비스" className={`${control} w-56`} />
            </label>
            <PendingButton pendingLabel="생성 중…" className={primaryBtn}>
              다음 → 계정 매핑
            </PendingButton>
          </form>
        )}

        {step === 3 && service && (
          <div className="space-y-3 text-sm">
            <form action={createAccountMap} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="serviceId" value={service.id} />
              <input type="hidden" name="redirectTo" value={qs({ mapped: "1" })} />
              <label className="block">
                <span className={`mb-1 block ${overline}`}>AWS 계정 ID (12자리)</span>
                <input
                  name="accountId"
                  required
                  pattern="\d{12}"
                  inputMode="numeric"
                  className={`${control} w-44 font-mono`}
                />
              </label>
              <label className="block">
                <span className={`mb-1 block ${overline}`}>별칭 (선택)</span>
                <input name="alias" placeholder="payment-prod" className={`${control} w-36`} />
              </label>
              <label className="block">
                <span className={`mb-1 block ${overline}`}>환경 (선택)</span>
                <input name="environment" placeholder="prd" className={`${control} w-24`} />
              </label>
              <PendingButton pendingLabel="매핑 중…" className={primaryBtn}>
                다음 → 담당 등록
              </PendingButton>
            </form>
            <p className="text-xs text-stone-400">
              이 계정에서 오는 알람이 방금 만든 서비스로 연결됩니다.{" "}
              <Link href={qs({ mapped: "1" })} className="text-indigo-600 underline">
                나중에 매핑 (건너뛰기)
              </Link>
            </p>
          </div>
        )}

        {step === 4 && customer && service && (
          <div className="space-y-4">
            <div>
              <div className={`mb-2 ${overline}`}>
                {service.name} 담당 등록{" "}
                <span className="font-normal normal-case tracking-normal">
                  (순서 1번이 가장 먼저 통지됩니다)
                </span>
              </div>
              <AssignmentEditor
                level="service"
                scopeId={service.id}
                customerId={customer.id}
                back={qs()}
              />
            </div>
            <div className="flex flex-wrap items-center gap-4 border-t border-stone-100 pt-4 text-[13px]">
              <Link
                href={`/admin/org?level=service&id=${service.id}`}
                className="inline-flex h-8 items-center border border-stone-900 bg-stone-900 px-[15px] font-semibold text-white transition-colors hover:bg-black"
              >
                온보딩 완료 → 조직 화면
              </Link>
              <Link
                href={`/admin/escalation?customerId=${customer.id}&projectId=${project?.id ?? ""}&serviceId=${service.id}&level=service`}
                className="text-indigo-600 hover:underline"
              >
                알람 처리 순서 정렬 →
              </Link>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
