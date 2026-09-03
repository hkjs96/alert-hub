import type { Metadata } from "next";
import Link from "next/link";
import { Space_Mono } from "next/font/google";
import localFont from "next/font/local";
import { NavTab } from "@/components/nav-tab";
import { PipelineHealth } from "@/components/pipeline-health";
import { UserChip } from "@/components/user-chip";
import "./globals.css";

// v2(웜 페이퍼 콘솔, docs/design/tokens.md): 본문은 Pretendard(가변,
// 셀프호스팅 — 한글·라틴·숫자가 한 서체로 통일된다), 수치·코드·오버라인은
// Space Mono. OFL 라이선스 원문은 src/fonts/PRETENDARD-LICENSE.txt.
const pretendard = localFont({
  src: "../fonts/PretendardVariable.woff2",
  weight: "45 920",
  display: "swap",
  variable: "--font-pretendard",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
});

export const metadata: Metadata = {
  title: "alert-hub",
  description: "Receive, dedup, and route fired alarms — the event plane.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${pretendard.variable} ${spaceMono.variable}`}
    >
      <body className="min-h-screen antialiased">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex h-[52px] max-w-7xl items-center justify-between px-6">
            <div className="flex items-center gap-8">
              <Link
                href="/"
                className="text-[15px] font-bold tracking-[-0.02em] text-stone-900"
              >
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
              <UserChip />
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
