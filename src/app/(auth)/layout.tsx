import Link from "next/link";
import { getCurrentUser } from "@/server/auth";
import { APP_VERSION } from "@/lib/version";

/**
 * 인증 셸 — 로고와 푸터만. 탭·파이프라인 상태·조직 트리는 그리지 않는다
 * (인증 화면 설계 원칙 01). 세션이 있으면(승인 대기·첫 로그인) 우측에 계정과
 * "다른 계정으로 로그인"을 둔다.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser();
  return (
    <div className="flex min-h-screen flex-col bg-[#efece5] text-stone-900">
      <div
        className={`flex h-[60px] items-center justify-between px-7 ${
          me ? "border-b border-stone-200 bg-[#fbfaf7]" : ""
        }`}
      >
        <Link href="/" className="text-[15px] font-bold tracking-[-0.02em] text-stone-900">
          alert<span className="text-indigo-600">·</span>hub
        </Link>
        {me ? (
          <div className="flex items-center gap-3.5 text-xs">
            <span className="text-stone-500">{me.email}</span>
            <span className="h-4 w-px bg-stone-200" />
            <form action="/api/auth/logout" method="post">
              <input type="hidden" name="next" value="/login" />
              <button type="submit" className="font-medium text-stone-500 hover:text-stone-900">
                다른 계정으로 로그인
              </button>
            </form>
          </div>
        ) : null}
      </div>
      <div className="flex flex-1 items-start justify-center px-6 py-12">{children}</div>
      <div className="flex h-14 items-center justify-between border-t border-stone-200 px-7 text-xs text-stone-400">
        <span>사내 운영 도구 · 접근 기록이 남습니다</span>
        <span className="font-mono text-[11px] text-stone-300">v{APP_VERSION}</span>
      </div>
    </div>
  );
}
