/**
 * 사람이 여는 공개 주소(Slack 버튼·그래프 이미지·메일 링크). APP_URL 이 있으면 그것,
 * 없으면 Vercel 이 알려 주는 운영 도메인(VERCEL_PROJECT_PRODUCTION_URL). 끝의 / 는 뗀다.
 */
export function appUrl(): string | null {
  const explicit = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim().replace(/\/+$/, "");
  return prod ? `https://${prod.replace(/^https?:\/\//, "")}` : null;
}
