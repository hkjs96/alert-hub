// 로그인 없이 통과하는 경로 — 미들웨어와 테스트가 같은 목록을 본다.
// 웹훅·크론·Slack 인터랙션은 자체 비밀(INGEST_TOKEN, CRON_SECRET, SLACK_SIGNING_SECRET)로
// 지키므로 세션과 무관.
const PUBLIC_PREFIXES = [
  "/api/webhooks/",
  "/api/cron/",
  "/api/auth/",
  "/api/slack/",
  // Slack 본문 그래프 이미지 — Slack 이 로그인 없이 가져간다. 알람 id + 만료 HMAC 서명으로 지킨다.
  "/api/g/",
  // CloudFormation 연결 템플릿(비밀 없음 — 값은 링크 파라미터로 들어간다). S3 에 올릴 원본 내려받기용.
  "/cfn/",
  "/login",
  "/verify/",
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
