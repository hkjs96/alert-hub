/**
 * Slack 본문 그래프용 서명 주소. Slack 은 이미지 주소에서 그림을 직접 가져오므로 로그인 없이
 * 열려야 한다 — 대신 알람 id + 만료 시각에 HMAC 서명을 붙여, 그 알람 하나의 그래프만,
 * 기한 안에만 열리게 한다. 서명 키는 GRAPH_URL_SECRET → AUTH_SECRET → CRON_SECRET 순.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const GRAPH_URL_TTL_DAYS = 30;

export function graphUrlSecret(): string | null {
  const s = (process.env.GRAPH_URL_SECRET || process.env.AUTH_SECRET || process.env.CRON_SECRET || "").trim();
  return s.length >= 16 ? s : null;
}

function sign(alertId: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`graph:${alertId}:${exp}`).digest("base64url");
}

/** 서명된 그래프 주소. 키나 APP_URL 이 없으면 null(그래프 없이 보낸다). */
export function signedGraphUrl(
  appUrl: string | null | undefined,
  alertId: string,
  now = Date.now(),
  secret = graphUrlSecret(),
): string | null {
  const base = appUrl?.replace(/\/+$/, "");
  if (!base || !secret) return null;
  const exp = Math.floor(now / 1000) + GRAPH_URL_TTL_DAYS * 86400;
  return `${base}/api/g/${encodeURIComponent(alertId)}.png?e=${exp}&s=${sign(alertId, exp, secret)}`;
}

export type GraphSigCheck = { ok: true } | { ok: false; reason: "missing" | "expired" | "bad" | "nokey" };

export function verifyGraphSig(
  alertId: string,
  e: string | null,
  s: string | null,
  now = Date.now(),
  secret = graphUrlSecret(),
): GraphSigCheck {
  if (!secret) return { ok: false, reason: "nokey" };
  if (!e || !s) return { ok: false, reason: "missing" };
  const exp = Number(e);
  if (!Number.isInteger(exp)) return { ok: false, reason: "bad" };
  const want = Buffer.from(sign(alertId, exp, secret));
  const got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "bad" };
  if (exp * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true };
}
