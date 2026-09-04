import Link from "next/link";
import { authMode, getCurrentUser } from "@/server/auth";
import { getMyScope } from "@/server/me";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { ToneLabel } from "@/components/auth/primitives";

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function fmtExp(exp: number): string {
  const d = new Date(exp * 1000);
  return d.toISOString().slice(0, 16).replace("T", " ") + "Z";
}

/**
 * 헤더 사용자 메뉴 (A5). `<details>` 로 여닫아 JS 없이 동작한다. 세션·권한·
 * 통지 채널·로그아웃. SSO가 열린 상태(open)면 관리자 진단으로 가는 작은
 * 표시만 남긴다 — 경고 문구 자체는 진단 화면(A6)의 몫이다.
 */
export async function UserMenu() {
  if (authMode() === "open") {
    return (
      <Link
        href="/admin/auth"
        className="font-mono text-[11px] text-stone-400 hover:text-stone-900"
        title="인증 공급자가 연결되지 않아 로그인 없이 열려 있습니다"
      >
        SSO 미연결
      </Link>
    );
  }
  const me = await getCurrentUser();
  if (!me) {
    return (
      <Link href="/login" className="text-sm font-medium text-stone-700 hover:text-stone-900">
        로그인
      </Link>
    );
  }
  const scope = await getMyScope(me.id);
  const channels = [
    me.slackId ? `Slack DM${me.slackVerifiedAt ? "" : "(미확인)"}` : null,
    me.email ? `이메일${me.emailVerifiedAt ? "" : "(미확인)"}` : null,
    me.phone ? "SMS" : null,
  ].filter(Boolean);
  const verified = Boolean(me.slackVerifiedAt || me.emailVerifiedAt);

  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 border border-transparent bg-transparent px-2 py-[5px] text-sm transition-colors hover:border-stone-900 hover:bg-stone-50 [&::-webkit-details-marker]:hidden">
        <span className="flex h-6 w-6 items-center justify-center border border-stone-900 bg-stone-900 text-[11px] font-semibold text-white">
          {initial(me.name)}
        </span>
        <span className="font-medium text-stone-900">{me.name}</span>
        {me.profileIncomplete ? (
          <span className="inline-block h-1.5 w-1.5 bg-[#b42318]" title="통지 채널이 비어 있습니다" />
        ) : null}
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#6b6862" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 6.5 8 10.5 12 6.5" />
        </svg>
      </summary>
      <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-[300px] border border-[#b8b2a4] bg-white shadow-[0_18px_44px_rgba(27,26,23,0.18)]">
        <div className="border-b border-[#eeebe4] px-[18px] py-4">
          <div className="flex items-center gap-[11px]">
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center border border-stone-900 bg-stone-900 text-[13px] font-semibold text-white">
              {initial(me.name)}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-stone-900">{me.name}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-stone-400">{me.email}</div>
            </div>
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-[7px]">
            <span className="border border-[#e0dcd3] px-[7px] py-[3px] font-mono text-[10px] font-bold tracking-[0.08em] text-[#4a5568]">
              {ROLE_LABELS[me.role]}
            </span>
            <span className="text-[11px] text-stone-400">담당 고객사 {scope.customerNames.length}곳</span>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-b border-[#eeebe4] px-[18px] py-3.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-bold tracking-[0.11em] text-stone-400">통지 채널</span>
            {verified ? <ToneLabel tone="ok">확인됨</ToneLabel> : channels.length ? <ToneLabel tone="warn">확인 필요</ToneLabel> : <ToneLabel tone="err">없음</ToneLabel>}
          </div>
          <div className="text-xs text-stone-500">
            {channels.length ? channels.join(" · ") : "Slack ID 또는 전화를 등록해야 알람을 받습니다"}
            {scope.assignmentCount ? ` · 배정 ${scope.assignmentCount}곳` : ""}
          </div>
        </div>
        <div className="py-1.5">
          <Link href="/me" className="flex items-center px-[18px] py-2.5 text-[13px] font-medium text-stone-900 hover:bg-stone-50">
            내 프로필 · 통지 채널
          </Link>
          {me.role === "ADMIN" ? (
            <Link href="/admin/auth" className="flex items-center px-[18px] py-2.5 text-[13px] font-medium text-stone-900 hover:bg-stone-50">
              인증 설정 진단
            </Link>
          ) : null}
          <form action="/api/auth/logout" method="post" className="mt-1.5 border-t border-[#f4f1ea]">
            <button type="submit" className="flex w-full items-center px-[18px] py-2.5 text-left text-[13px] font-medium text-[#b42318] hover:bg-stone-50">
              로그아웃
            </button>
          </form>
        </div>
        <div className="border-t border-[#eeebe4] px-[18px] py-3 font-mono text-[11px] text-stone-300">
          세션 만료 <span className="text-stone-400">{fmtExp(me.sessionExp)}</span>
        </div>
      </div>
    </details>
  );
}
