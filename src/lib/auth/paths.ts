// 로그인 없이 통과하는 경로 — 미들웨어와 테스트가 같은 목록을 본다.
// 웹훅·크론은 자체 비밀(INGEST_TOKEN, CRON_SECRET)로 지키므로 세션과 무관.
const PUBLIC_PREFIXES = [
  "/api/webhooks/",
  "/api/cron/",
  "/api/auth/",
  "/login",
  "/_next/",
  "/fonts/",
  "/favicon",
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));
}

/** 로그인 후 돌아갈 경로 — 사이트 내부 절대경로만 허용(오픈 리다이렉트 방지). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/api/")) return "/";
  return next;
}
