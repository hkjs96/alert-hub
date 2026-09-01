import type { Metadata } from "next";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

// B안(라이트 정밀, docs/design/tokens.md): 라틴은 Geist, 한글은 Noto Sans KR
// 폴백 — 굵기와 자간으로 위계를 만드는 타이포가 이 방향의 정체성이다.
const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto-kr",
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
      className={`${GeistSans.variable} ${GeistMono.variable} ${notoSansKr.variable}`}
    >
      <body className="min-h-screen antialiased">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link
              href="/"
              className="text-lg font-semibold tracking-tight text-stone-900"
            >
              alert-hub
            </Link>
            <div className="flex items-center gap-4">
              <Link
                href="/admin"
                className="text-sm text-stone-600 hover:text-indigo-600"
              >
                등록관리
              </Link>
              <span className="text-sm text-stone-400">event plane · MVP</span>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
