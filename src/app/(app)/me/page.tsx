import Link from "next/link";
import { ProfileCard } from "@/components/auth/profile-card";
import { overline } from "@/components/auth/primitives";
import { authMode, getCurrentUser } from "@/server/auth";
import { getMyScope } from "@/server/me";
import { slackNotifier } from "@/lib/notify/slack";
import { emailNotifier } from "@/lib/notify/email";

export const dynamic = "force-dynamic";

/**
 * 내 프로필 · 통지 채널 — 첫 로그인 카드(A3)와 같은 본문을 앱 셸 안에서.
 */
export default async function MePage({ searchParams }: { searchParams: { saved?: string; verify?: string; rq?: string } }) {
  const me = await getCurrentUser();
  if (!me) {
    const open = authMode() === "open";
    return (
      <div className="mx-auto mt-10 max-w-md space-y-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-stone-900">내 프로필 · 통지 채널</h1>
        <p className="text-sm text-stone-500">
          {open
            ? "인증 공급자가 연결되면 각자 자기 통지 채널을 여기서 관리합니다. 지금은 관리자가 팀 · 내부 인원에서 대신 입력합니다."
            : "로그인하면 자기 Slack ID·전화번호를 직접 관리할 수 있습니다."}
        </p>
        <Link
          href={open ? "/admin/teams" : "/login?next=/me"}
          className="inline-flex h-9 items-center border border-stone-900 bg-stone-900 px-3.5 text-[13px] font-semibold text-white"
        >
          {open ? "팀 · 내부 인원으로" : "로그인"}
        </Link>
      </div>
    );
  }
  const scope = await getMyScope(me.id);
  return (
    <div className="mx-auto w-[600px] max-w-full space-y-5">
      {searchParams.saved ? (
        <p className="border border-stone-200 bg-white px-4 py-2.5 text-[13px] text-stone-600">저장했습니다.</p>
      ) : null}
      <ProfileCard
        me={me}
        back="/me"
        verify={searchParams.verify}
        configured={{ slack: slackNotifier.isConfigured(), email: emailNotifier.isConfigured() }}
        heading="내 프로필 · 통지 채널"
        intro="Slack ID 또는 전화번호 중 하나는 있어야 알람 순서에서 실제로 연락을 받습니다."
      />
      <div className="border border-stone-200 bg-white px-[34px] py-6">
        <div className={overline}>내 담당 범위</div>
        <p className="mt-2 text-[13px] text-stone-700">
          담당 고객사 {scope.customerNames.length}곳 · 스코프 배정 {scope.assignmentCount}곳
          {scope.teams.length ? ` · 팀 ${scope.teams.map((t) => t.name).join(", ")}` : ""}
        </p>
        <p className="mt-1 text-xs text-stone-400">
          배정과 순서는{" "}
          <Link href="/admin/escalation" className="text-indigo-600 underline">
            알람 처리 순서
          </Link>
          에서 관리합니다.
        </p>
      </div>
    </div>
  );
}
