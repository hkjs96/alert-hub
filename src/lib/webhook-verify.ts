import { createHmac, createVerify, timingSafeEqual } from "node:crypto";

// 수신 웹훅의 출처 증명 (운영 경화).
//
// INGEST_TOKEN은 "URL을 아는 사람"을 거르는 공유 비밀이고, 여기는 한 단계
// 위다: SNS 봉투는 AWS가 서명한 것인지(위조 봉투로 가짜 알람·SSRF 유도 차단),
// PagerDuty는 등록된 웹훅 비밀로 HMAC이 맞는지 본다. 검증 로직은 fetch를
// 주입받는 순수 함수로 두어 인증서 없이도 단위 테스트가 된다.

// --- SNS message signature ---------------------------------------------------
// https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
// 캐노니컬 문자열은 타입별 고정 키 순서의 `key\nvalue\n` 연접이고, 서명은
// SigningCertURL의 X.509 인증서로 RSA-SHA1(버전 1) / RSA-SHA256(버전 2) 검증.

const NOTIFICATION_KEYS = [
  "Message",
  "MessageId",
  "Subject",
  "Timestamp",
  "TopicArn",
  "Type",
] as const;

const SUBSCRIPTION_KEYS = [
  "Message",
  "MessageId",
  "SubscribeURL",
  "Timestamp",
  "Token",
  "TopicArn",
  "Type",
] as const;

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/** SigningCertURL은 반드시 SNS의 .pem이어야 한다 — 아니면 임의 URL fetch다. */
export function isSnsSigningCertUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(url.hostname) &&
      url.pathname.endsWith(".pem")
    );
  } catch {
    return false;
  }
}

/** 타입별 키 순서대로 `key\nvalue\n`. 서명 대상이 아닌 키는 제외. */
export function buildSnsCanonicalString(
  msg: Record<string, unknown>,
): string | null {
  const type = msg.Type;
  if (type !== "Notification" && type !== "SubscriptionConfirmation" && type !== "UnsubscribeConfirmation") {
    return null;
  }
  const keys = type === "Notification" ? NOTIFICATION_KEYS : SUBSCRIPTION_KEYS;
  let out = "";
  for (const key of keys) {
    const value = msg[key];
    if (typeof value === "string") out += `${key}\n${value}\n`;
  }
  return out;
}

/**
 * 서명 자체의 검증 (동기·순수). certPem은 SNS가 주는 X.509 인증서 —
 * 테스트에서는 공개키 PEM을 그대로 넣어도 된다.
 */
export function verifySnsSignature(
  msg: Record<string, unknown>,
  certPem: string,
): VerifyResult {
  const signature = msg.Signature;
  if (typeof signature !== "string") return { ok: false, reason: "missing Signature" };

  const canonical = buildSnsCanonicalString(msg);
  if (!canonical) return { ok: false, reason: `unsupported Type ${String(msg.Type)}` };

  const version = typeof msg.SignatureVersion === "string" ? msg.SignatureVersion : "1";
  const algo = version === "2" ? "RSA-SHA256" : "RSA-SHA1";

  try {
    const verifier = createVerify(algo);
    verifier.update(canonical, "utf8");
    return verifier.verify(certPem, signature, "base64")
      ? { ok: true }
      : { ok: false, reason: "signature mismatch" };
  } catch (err) {
    return {
      ok: false,
      reason: `verification error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// 인증서는 토픽/리전당 사실상 고정이라 메모리 캐시로 충분하다 (서버리스
// 인스턴스 수명 동안). 실패 응답은 캐시하지 않는다.
const certCache = new Map<string, string>();
const MAX_CERT_BYTES = 64 * 1024;

async function fetchSigningCert(url: string): Promise<string> {
  const cached = certCache.get(url);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cert fetch returned ${res.status}`);
  const text = await res.text();
  if (Buffer.byteLength(text) > MAX_CERT_BYTES) {
    throw new Error("cert unexpectedly large");
  }
  certCache.set(url, text);
  return text;
}

/**
 * SNS 봉투 전체 검증: SigningCertURL 검증 → 인증서 확보 → 서명 확인.
 * fetchCert 주입은 테스트용이자, 인증서 캐시를 우회하고 싶을 때의 통로.
 */
export async function verifySnsMessage(
  msg: Record<string, unknown>,
  fetchCert: (url: string) => Promise<string> = fetchSigningCert,
): Promise<VerifyResult> {
  const certUrl = msg.SigningCertURL ?? msg.SigningCertUrl;
  if (typeof certUrl !== "string" || !isSnsSigningCertUrl(certUrl)) {
    return { ok: false, reason: "invalid SigningCertURL" };
  }
  let certPem: string;
  try {
    certPem = await fetchCert(certUrl);
  } catch (err) {
    return {
      ok: false,
      reason: `cert fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return verifySnsSignature(msg, certPem);
}

// --- PagerDuty v3 webhook signature ------------------------------------------
// https://developer.pagerduty.com/docs/verifying-webhook-signatures
// 헤더 X-PagerDuty-Signature: "v1=<hex>,v1=<hex>..." — 원문 바디의
// HMAC-SHA256(secret)이 그중 하나와 일치하면 통과 (비밀 로테이션 중에는
// 서명이 여러 개 실린다).

export function verifyPagerDutySignature(
  rawBody: string,
  header: string | null,
  secret: string,
): VerifyResult {
  if (!header) return { ok: false, reason: "missing X-PagerDuty-Signature" };

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const candidates = header
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("v1="))
    .map((s) => s.slice(3));
  if (candidates.length === 0) {
    return { ok: false, reason: "no v1 signature in header" };
  }

  for (const hex of candidates) {
    let buf: Buffer;
    try {
      buf = Buffer.from(hex, "hex");
    } catch {
      continue;
    }
    if (buf.length === expected.length && timingSafeEqual(buf, expected)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "signature mismatch" };
}
