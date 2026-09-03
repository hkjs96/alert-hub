import Link from "next/link";
import { readAuthConfig } from "@/lib/auth/config";
import { getCurrentUser } from "@/server/auth";

/**
 * 헤더 우측: 로그인한 사람 → 이름(프로필 링크) + 로그아웃. SSO가 꺼져 있으면
 * "SSO 미설정"을 작게 남겨 지금이 열린 상태임을 숨기지 않는다.
 */
export async function UserChip() {
  const cfg = readAuthConfig();
  if (!cfg.enabled) {
    return (
      <Link
        href="/login"
        title={cfg.reason}
        className="font-mono text-xs text-stone-400 hover:text-stone-900"
      >
        SSO 미설정 · 열림
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
  return (
    <span className="flex items-center gap-3 text-sm">
      <Link
        href="/me"
        className="flex items-center gap-1.5 font-medium text-stone-900 hover:underline"
        title={me.email}
      >
        {me.name}
        {me.profileIncomplete ? (
          <span
            className="inline-block h-1.5 w-1.5 bg-[#b42318]"
            title="통지 채널이 비어 있습니다 — Slack ID 또는 전화를 채우세요"
          />
        ) : null}
      </Link>
      <form action="/api/auth/logout" method="post">
        <button type="submit" className="text-xs text-stone-400 hover:text-stone-900">
          로그아웃
        </button>
      </form>
    </span>
  );
}
