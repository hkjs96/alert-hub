import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Slack 요청 서명 검증 (v0). `v0=` + HMAC-SHA256(signing secret, "v0:{ts}:{body}").
 * 타임스탬프가 5분 이상 어긋나면 재전송 공격으로 보고 거부한다.
 */
export function verifySlackSignature(
  secret: string,
  timestamp: string | null,
  body: string,
  signature: string | null,
  now: Date = new Date(),
): boolean {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(now.getTime() / 1000 - ts) > 60 * 5) return false;
  const expected = "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 서명 생성 (테스트·모의 클라이언트용). */
export function signSlackRequest(secret: string, timestamp: string, body: string): string {
  return "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");
}

export interface BlockAction {
  type: "block_actions";
  user: { id: string; username?: string; name?: string };
  channel?: { id: string; name?: string };
  message?: { ts?: string; text?: string };
  container?: { channel_id?: string; message_ts?: string; is_ephemeral?: boolean };
  response_url?: string;
  actions: { action_id: string; value?: string; block_id?: string }[];
}

/** application/x-www-form-urlencoded 의 payload= JSON. 아니면 null. */
export function parseInteractionBody(body: string): BlockAction | null {
  try {
    const params = new URLSearchParams(body);
    const raw = params.get("payload");
    if (!raw) return null;
    const json = JSON.parse(raw);
    if (json?.type !== "block_actions" || !Array.isArray(json.actions) || !json.user?.id) return null;
    return json as BlockAction;
  } catch {
    return null;
  }
}
