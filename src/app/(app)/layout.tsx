import Link from "next/link";
import { redirect } from "next/navigation";
import { NavTab } from "@/components/nav-tab";
import { PipelineHealth } from "@/components/pipeline-health";
import { UserMenu } from "@/components/auth/user-menu";
import { getCurrentUser } from "@/server/auth";

/**
 * 앱 셸 — 로그인된(또는 SSO 미연결로 열린) 상태에서만 그려진다. 승인 대기
 * 계정은 /pending 으로, 아직 첫 로그인 프로필을 마치지 않은 계정은 /welcome
 * 으로 보낸다. 두 화면은 (auth) 셸에 있다.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser();
  if (me?.status === "PENDING") redirect("/pending");
  if (me && me.status === "ACTIVE" && !me.onboardedAt) redirect("/welcome");

  return (
    <>
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-[52px] max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-[15px] font-bold tracking-[-0.02em] text-stone-900">
              alert<span className="text-indigo-600">·</span>hub
            </Link>
            <nav className="flex gap-6 text-sm">
              <NavTab
                href="/"
                label="대시보드"
                pattern="^/(?!admin)"
                className="flex h-[52px] items-center"
                activeClassName="font-semibold text-stone-900 shadow-[inset_0_-2px_0_#1b1a17]"
                inactiveClassName="text-stone-500 hover:text-stone-900"
              />
              <NavTab
                href="/admin"
                label="등록 관리"
                pattern="^/admin"
                className="flex h-[52px] items-center"
                activeClassName="font-semibold text-stone-900 shadow-[inset_0_-2px_0_#1b1a17]"
                inactiveClassName="text-stone-500 hover:text-stone-900"
              />
            </nav>
          </div>
          <span className="flex items-center gap-5">
            <PipelineHealth />
            <span className="hidden h-[18px] w-px bg-stone-200 sm:block" />
            <UserMenu />
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </>
  );
}
