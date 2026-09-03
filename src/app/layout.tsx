import type { Metadata } from "next";
import { Space_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

// v2(웜 페이퍼 콘솔, docs/design/tokens.md): 본문은 Pretendard(가변,
// 셀프호스팅 — 한글·라틴·숫자가 한 서체로 통일된다), 수치·코드·오버라인은
// Space Mono. OFL 라이선스 원문은 src/fonts/PRETENDARD-LICENSE.txt.
//
// 루트 레이아웃은 문서 껍데기만. 앱 셸(헤더·탭)은 (app) 그룹, 인증 셸(로고·
// 푸터만)은 (auth) 그룹이 각각 그린다 — 로그아웃 상태에서 탭·파이프라인
// 상태가 보이지 않게 하는 분리(인증 화면 설계 원칙 01).
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${pretendard.variable} ${spaceMono.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
