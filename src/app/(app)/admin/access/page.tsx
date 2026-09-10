import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSignupPolicy } from "@/server/settings";
import { setSignupPolicy } from "@/server/auth-actions";
import { PendingApprovals } from "@/components/admin/pending-approvals";
import { ContactRoster } from "@/components/admin/contact-roster";
import { PendingButton } from "@/components/pending-button";

export const dynamic = "force-dynamic";

/**
 * 계정 · 접근 — "누가 들어올 수 있고, 들어오면 무엇을 보나"를 한 화면에.
 * 가입 방식(승인제/자동), 승인 대기, 내부 인원(역할·활성·전체 보기), 고객사 로그인 도메인.
 * 공급자·통지 채널 상태표는 시스템 진단(/admin/auth)에 있다.
 */
export default async function AccessPage({ searchParams }: { searchParams: { vreq?: string } }) {
  const [policy, customers] = await Promise.all([
    getSignupPolicy(),
    prisma.customer.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, loginDomains: true, _count: { select: { contacts: true } } },
    }),
  ]);
  const back = "/admin/access";
  const withLogin = customers.filter((c) => c.loginDomains);

  return (
    <div className="space-y-[26px]">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-stone-900">계정 · 접근</h1>
        <p className="mt-1 text-sm text-stone-500">
          누가 로그인할 수 있고(허용 도메인 · 고객사 도메인), 처음 들어온 사람을 어떻게 받으며(승인제 · 자동 승인),
          내부 인원이 무엇을 보는지(역할 · 전체 보기)를 여기서 정합니다. 공급자 연결 상태는{" "}
          <Link href="/admin/auth" className="text-indigo-600 underline">시스템 진단</Link>에서 봅니다.
        </p>
      </div>

      <section id="signup" className="border border-stone-200 bg-white">
        <div className="flex flex-wrap items-baseline gap-2 border-b border-stone-200 px-5 py-3">
          <h2 className="text-[13px] font-semibold text-stone-900">가입 방식</h2>
          <span className="text-xs text-stone-400">
            처음 SSO 로그인한 계정(내부 허용 목록 · 고객사 로그인 도메인)을 어떻게 받을지. 여기서 바꾸면 환경변수보다 우선합니다.
          </span>
        </div>
        <form action={setSignupPolicy} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 text-sm">
          <label className="inline-flex cursor-pointer items-center gap-2 text-stone-800">
            <input type="radio" name="mode" value="off" defaultChecked={!policy.autoApprove} className="accent-stone-900" />
            승인제 <span className="text-xs text-stone-400">— 승인 대기에 올라오고 관리자가 승인해야 활성</span>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 text-stone-800">
            <input type="radio" name="mode" value="on" defaultChecked={policy.autoApprove} className="accent-stone-900" />
            자동 승인 <span className="text-xs text-stone-400">— 허용된 계정은 로그인 즉시 활성</span>
          </label>
          <PendingButton
            pendingLabel="저장 중…"
            className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700"
          >
            저장
          </PendingButton>
          <span className="basis-full text-xs text-stone-400">
            현재: {policy.autoApprove ? "자동 승인" : "승인제"} ·{" "}
            {policy.source === "setting" ? "화면에서 설정한 값" : policy.source === "env" ? "AUTH_AUTO_APPROVE 환경변수 값" : "기본값(승인제)"}
            . 부트스트랩 관리자(AUTH_BOOTSTRAP_ADMINS)와 관리자가 미리 등록한 인원은 어느 쪽이든 바로 활성입니다.
          </span>
        </form>
      </section>

      <PendingApprovals always />

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-sm font-semibold text-stone-900">내부 인원</h2>
          <span className="text-xs text-stone-400">
            고객사에 속하지 않은 MSP 담당자 · 역할(관리자 · 온콜 · 조회) · 활성 · 전체 보기 · 통지 채널 확인
          </span>
        </div>
        <ContactRoster scope="internal" back={back} vreq={searchParams.vreq} />
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-sm font-semibold text-stone-900">고객사 담당자 로그인</h2>
          <span className="text-xs text-stone-400">
            도메인을 켠 고객사 {withLogin.length}곳 / {customers.length}곳 · 도메인은 각 고객사 패널의 “담당자 로그인”에서 편집
          </span>
        </div>
        <ul className="divide-y divide-stone-200 border border-stone-200 bg-white text-sm">
          {customers.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="font-medium text-stone-900">{c.name}</span>
              {c.loginDomains ? (
                <span className="font-mono text-xs text-stone-700">@{c.loginDomains.split(",").join(" · @")}</span>
              ) : (
                <span className="text-xs text-stone-400">로그인 꺼짐</span>
              )}
              <span className="text-xs text-stone-400">담당자 {c._count.contacts}명</span>
              <Link href={`/admin/org?level=customer&id=${c.id}`} className="ml-auto text-xs text-indigo-600 underline">
                고객사 패널 →
              </Link>
            </li>
          ))}
          {customers.length === 0 ? <li className="px-4 py-3 text-xs text-stone-400">고객사가 없습니다.</li> : null}
        </ul>
      </section>
    </div>
  );
}
