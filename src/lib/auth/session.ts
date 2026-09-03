// 세션 쿠키: `base64url(payload).base64url(HMAC-SHA256)`. 미들웨어(Edge)와
// 서버 컴포넌트(Node) 양쪽에서 돌아가야 하므로 Web Crypto만 쓴다.
// 서버에 세션 테이블을 두지 않는다 — 비활성 처리는 다음 요청에서
// getCurrentUser가 DB의 active를 다시 확인해 끊는다.

export interface SessionPayload {
  /** Contact.id */
  sub: string;
  email: string;
  name: string;
  /** epoch seconds */
  exp: number;
  /** epoch seconds — 발급 시각 */
  iat: number;
}

export const SESSION_COOKIE = "ah_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array | null {
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(
  payload: Omit<SessionPayload, "exp" | "iat"> & Partial<Pick<SessionPayload, "exp" | "iat">>,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const full: SessionPayload = {
    ...payload,
    iat: payload.iat ?? now,
    exp: payload.exp ?? now + SESSION_TTL_SECONDS,
  };
  const body = b64url(enc.encode(JSON.stringify(full)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

/** 서명·만료가 유효하면 payload, 아니면 null. 절대 throw하지 않는다. */
export async function verifySession(
  token: string | undefined | null,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<SessionPayload | null> {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = unb64url(token.slice(dot + 1));
  if (!sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, enc.encode(body));
  if (!ok) return null;
  const raw = unb64url(body);
  if (!raw) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(raw)) as Partial<SessionPayload>;
    if (typeof p.sub !== "string" || typeof p.email !== "string" || typeof p.exp !== "number") {
      return null;
    }
    if (p.exp <= now) return null;
    return {
      sub: p.sub,
      email: p.email,
      name: typeof p.name === "string" ? p.name : p.email,
      exp: p.exp,
      iat: typeof p.iat === "number" ? p.iat : 0,
    };
  } catch {
    return null;
  }
}

/** state/nonce 용 랜덤 문자열. */
export function randomToken(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64url(buf);
}
