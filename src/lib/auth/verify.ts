// 통지 채널 확인 코드 — 순수 함수. 6자리 숫자, 해시로만 저장, 10분 유효.

export const VERIFY_TTL_MS = 10 * 60 * 1000;

export function generateCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

export async function hashCode(code: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${code.trim()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type VerifyState = "unregistered" | "unverified" | "verified";

export function channelState(value: string | null | undefined, verifiedAt: Date | null | undefined): VerifyState {
  if (!value) return "unregistered";
  return verifiedAt ? "verified" : "unverified";
}

/** 입력 코드가 유효한가: 해시 일치 + 만료 전 + 같은 채널. */
export async function checkCode(p: {
  input: string;
  hash: string | null;
  salt: string;
  expiresAt: Date | null;
  channel: string | null;
  expectedChannel: string;
  now?: Date;
}): Promise<boolean> {
  const now = p.now ?? new Date();
  if (!p.hash || !p.expiresAt || p.channel !== p.expectedChannel) return false;
  if (p.expiresAt.getTime() < now.getTime()) return false;
  if (!/^\d{6}$/.test(p.input.trim())) return false;
  return (await hashCode(p.input, p.salt)) === p.hash;
}

/** 관리자 대리 확인 링크 토큰 (URL-safe, 32바이트). 저장은 hashCode(token, "link"). */
export function newLinkToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const LINK_TTL_MS = 24 * 60 * 60 * 1000;

export type VerifyChannel = "slack" | "email" | "sms";

export function isVerifyChannel(v: unknown): v is VerifyChannel {
  return v === "slack" || v === "email" || v === "sms";
}

/** 확인 방식 라벨. */
export function viaLabel(via: string | null | undefined): string {
  if (!via) return "";
  if (via === "code") return "본인 코드";
  if (via === "link") return "링크 클릭";
  if (via === "sso") return "SSO 보증";
  if (via === "slack-lookup") return "Slack 매칭";
  if (via.startsWith("admin:")) return `관리자 수동 (${via.slice(6)})`;
  return via;
}
