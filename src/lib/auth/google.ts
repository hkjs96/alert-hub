// Google OIDC — 라이브러리 없이 authorization code 흐름만. id_token은 우리가
// client_secret으로 직접 토큰 엔드포인트에서 받아오므로(TLS) 서명 검증 대신
// 클레임(iss/aud/exp/nonce/email_verified)만 확인한다. 그래도 헐거운 부분은
// 없다: 코드 교환 없이 위조된 토큰이 들어올 경로가 없다.

export const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

export function authorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  /** 허용 도메인이 정확히 하나면 Google 계정 선택 화면을 그 도메인으로 좁힌다. */
  hd?: string;
  /** 사용자가 적은 회사 이메일 — 계정 선택을 건너뛴다. */
  loginHint?: string;
}): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: p.state,
    nonce: p.nonce,
    prompt: "select_account",
  });
  if (p.hd) q.set("hd", p.hd);
  if (p.loginHint) q.set("login_hint", p.loginHint);
  return `${GOOGLE_AUTHORIZE}?${q.toString()}`;
}

export interface IdTokenClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  hd?: string;
}

/** JWT payload 디코드(검증 없음). 깨진 토큰이면 null. */
export function decodeIdToken(idToken: string): IdTokenClaims | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const pad = parts[1].length % 4 === 0 ? "" : "=".repeat(4 - (parts[1].length % 4));
    const bin = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/") + pad);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as IdTokenClaims;
  } catch {
    return null;
  }
}

export type ClaimCheck =
  | { ok: true; email: string; name: string; sub: string }
  | { ok: false; reason: string };

export function validateClaims(
  c: IdTokenClaims | null,
  p: { clientId: string; nonce: string; now?: number },
): ClaimCheck {
  const now = p.now ?? Math.floor(Date.now() / 1000);
  if (!c) return { ok: false, reason: "id_token 해독 실패" };
  if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com") {
    return { ok: false, reason: "발급자(iss) 불일치" };
  }
  if (c.aud !== p.clientId) return { ok: false, reason: "대상(aud) 불일치" };
  if (typeof c.exp !== "number" || c.exp <= now) return { ok: false, reason: "토큰 만료" };
  if (!c.nonce || c.nonce !== p.nonce) return { ok: false, reason: "nonce 불일치" };
  if (!c.email || c.email_verified !== true) {
    return { ok: false, reason: "검증된 이메일이 없는 계정" };
  }
  if (!c.sub) return { ok: false, reason: "sub 없음" };
  return { ok: true, email: c.email.toLowerCase(), name: c.name?.trim() || c.email, sub: c.sub };
}

export async function exchangeCode(
  p: { code: string; clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ id_token?: string; error?: string; error_description?: string }> {
  const res = await fetchImpl(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: p.code,
      client_id: p.clientId,
      client_secret: p.clientSecret,
      redirect_uri: p.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  try {
    return (await res.json()) as { id_token?: string; error?: string; error_description?: string };
  } catch {
    return { error: "invalid_response", error_description: `HTTP ${res.status}` };
  }
}
