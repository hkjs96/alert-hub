import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileCard } from "@/components/auth/profile-card";
import { btnPrimaryAccent, btnSecondary, overline } from "@/components/auth/primitives";
import { PendingButton } from "@/components/pending-button";
import { authMode, getCurrentUser } from "@/server/auth";
import { completeOnboarding } from "@/server/auth-actions";
import { getMyScope } from "@/server/me";
import { slackNotifier } from "@/lib/notify/slack";
import { emailNotifier } from "@/lib/notify/email";

export const dynamic = "force-dynamic";

const STEPS = ["프로필", "담당 범위", "완료"];

function Steps({ current }: { current: number }) {
  return (
    <div className="mb-[26px] flex items-center">
      {STEPS.map((t, i) => {
        const n = i + 1;
        const state = n === current ? "on" : n < current ? "done" : n === current + 1 ? "next" : "off";
        const ink = state === "on" || state === "done";
        return (
          <div key={t} className={`flex items-center gap-2 ${i < STEPS.length - 1 ? "flex-1" : ""}`}>
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center border font-mono text-[10px] font-bold ${
                ink ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white"
              } ${state === "next" ? "text-stone-500" : state === "off" ? "text-stone-300" : ""}`}
            >
              {n}
            </span>
            <span
              className={`whitespace-nowrap text-[13px] ${
                state === "on" ? "font-semibold text-stone-900" : state === "done" ? "font-medium text-stone-700" : state === "next" ? "font-medium text-stone-500" : "font-medium text-stone-300"
              }`}
            >
              {t}
            </span>
            {i < STEPS.length - 1 ? <span className="mx-3 h-px flex-1 bg-stone-200" /> : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 첫 로그인 — 프로필 완성 (A3). 1 프로필·통지 채널 → 2 담당 범위 확인 → 3 완료.
 * 통지 채널이 없으면 알람을 못 받으므로 1단계가 핵심이고, 건너뛰기는 언제든
 * /me 로 돌아올 수 있다는 전제 아래 둔다.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: { step?: string; verify?: string; saved?: string };
}) {
  if (authMode() === "open") redirect("/");
  const me = await getCurrentUser();
  if (!me) redirect("/login?next=/welcome");
  if (me.status === "PENDING") redirect("/pending");
  const step = Math.min(3, Math.max(1, Number(searchParams.step ?? "1") || 1));
  const scope = step >= 2 ? await getMyScope(me.id) : null;
  const connected = [me.slackVerifiedAt, me.emailVerifiedAt].filter(Boolean).length;

  return (
    <div className="w-[600px] max-w-full">
      <Steps current={step} />

      {step === 1 ? (
        <>
          <ProfileCard
            me={me}
            back="/welcome?step=1"
            verify={searchParams.verify}
            configured={{ slack: slackNotifier.isConfigured(), email: emailNotifier.isConfigured() }}
            heading={<>환영합니다, {me.name}님</>}
            intro="알람을 받을 채널을 등록하면 설정이 끝납니다. Google 계정에서 가져온 정보는 수정할 수 있습니다."
          />
          <div className="mt-[26px] flex items-center justify-between">
            <span className="text-xs text-stone-400">나중에 내 프로필에서 언제든 변경할 수 있습니다.</span>
            <div className="flex gap-2">
              <form action={completeOnboarding}>
                <input type="hidden" name="back" value="/" />
                <PendingButton pendingLabel="…" className={btnSecondary}>
                  건너뛰기
                </PendingButton>
              </form>
              <Link href="/welcome?step=2" className={btnPrimaryAccent}>
                다음 — 담당 범위 확인
              </Link>
            </div>
          </div>
        </>
      ) : step === 2 && scope ? (
        <>
          <div className="border border-stone-200 bg-white px-[34px] py-8">
            <h1 className="text-[21px] font-semibold leading-tight tracking-[-0.025em] text-stone-900">담당 범위</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-stone-500">
              지금 알람 처리 순서에 등록된 자리입니다. 비어 있으면 관리자가 조직 트리에서 배정한 뒤 알람이 오기
              시작합니다.
            </p>
            <div className="my-[26px] h-px bg-[#eeebe4]" />
            <div className={overline}>스코프 배정 · {scope.assignments.length}곳</div>
            {scope.assignments.length === 0 ? (
              <p className="mt-2 border border-dashed border-stone-200 px-4 py-4 text-[13px] text-stone-400">
                아직 배정이 없습니다.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-[#f4f1ea] border border-[#eeebe4]">
                {scope.assignments.map((a) => (
                  <li key={a.id + (a.via ?? "")} className="flex items-center gap-2 px-4 py-2.5 text-[13px]">
                    <span className="text-stone-900">{a.label}</span>
                    {a.via ? (
                      <span className="border border-stone-200 px-1 font-mono text-[11px] text-stone-500">팀 {a.via}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div className={`mt-5 ${overline}`}>팀 소속 · {scope.teams.length}개</div>
            <p className="mt-2 text-[13px] text-stone-700">
              {scope.teams.length
                ? scope.teams.map((t) => `${t.name}${t.customer ? ` (${t.customer})` : ""}`).join(", ")
                : "없음"}
            </p>
            <div className={`mt-5 ${overline}`}>담당 고객사 · {scope.customerNames.length}곳</div>
            <p className="mt-2 text-[13px] text-stone-700">{scope.customerNames.join(", ") || "없음"}</p>
          </div>
          <div className="mt-[26px] flex items-center justify-between">
            <Link href="/welcome?step=1" className={btnSecondary}>
              이전
            </Link>
            <Link href="/welcome?step=3" className={btnPrimaryAccent}>
              다음 — 완료
            </Link>
          </div>
        </>
      ) : (
        <>
          <div className="border border-stone-200 bg-white px-[34px] py-8">
            <h1 className="text-[21px] font-semibold leading-tight tracking-[-0.025em] text-stone-900">설정이 끝났습니다</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-stone-500">
              {connected
                ? `확인된 통지 채널 ${connected}개. 담당 알람이 발화하면 순서에 따라 연락이 갑니다.`
                : "아직 확인된 통지 채널이 없습니다. 내 프로필에서 코드로 확인해야 실제로 도달하는지 알 수 있습니다."}
            </p>
            <div className="my-[26px] h-px bg-[#eeebe4]" />
            <ul className="space-y-1.5 text-[13px] text-stone-700">
              <li>· Slack DM {me.slackId ? `@${me.slackId}${me.slackVerifiedAt ? " · 확인됨" : " · 확인 필요"}` : "미등록"}</li>
              <li>· 이메일 {me.email}{me.emailVerifiedAt ? " · 확인됨" : " · 확인 필요"}</li>
              <li>· SMS {me.phone ?? "미연결 (에스컬레이션 전용)"}</li>
              <li>· 담당 고객사 {scope?.customerNames.length ?? 0}곳 · 배정 {scope?.assignmentCount ?? 0}곳</li>
            </ul>
          </div>
          <div className="mt-[26px] flex items-center justify-between">
            <Link href="/welcome?step=2" className={btnSecondary}>
              이전
            </Link>
            <form action={completeOnboarding}>
              <input type="hidden" name="back" value="/" />
              <PendingButton pendingLabel="…" className={btnPrimaryAccent}>
                대시보드로
              </PendingButton>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
