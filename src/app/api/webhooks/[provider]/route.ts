import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { isRecord } from "@/lib/normalize";
import { AUTO_DETECT, isKnownProvider, normalizeWith } from "@/lib/providers";
import {
  verifyPagerDutySignature,
  verifySnsMessage,
} from "@/lib/webhook-verify";
import { ingestAlerts } from "@/server/alerts";

// Needs Node APIs (Prisma, crypto) and must never be statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cap stored payload size; `raw` is persisted verbatim and SNS/monitoring
// payloads are far smaller than this.
const MAX_BODY_BYTES = 1_000_000;

/** Constant-time string comparison (hash first so lengths never leak). */
function safeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

/**
 * Only ever confirm subscriptions against real SNS endpoints. Without this, a
 * forged envelope could make this server GET an arbitrary (e.g. internal) URL.
 */
function isSnsSubscribeUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * POST /api/webhooks/<provider>
 *
 * Two layers:
 *   1. Transport — an SNS envelope ({ Type, TopicArn, ... }) is peeled here:
 *      SubscriptionConfirmation is auto-confirmed via SubscribeURL (after
 *      validating it points at SNS); a Notification has its `Message` (a JSON
 *      string) parsed into the inner payload. Otherwise the raw body is the
 *      payload.
 *   2. Provider — the URL segment picks the parser:
 *        /grafana /prometheus /pagerduty /cloudwatch /generic  → that parser
 *        /alarm                                                → auto-detect
 *
 * Auth, three independent layers:
 *   - INGEST_TOKEN (set ⇒ required): shared secret in the `x-webhook-token`
 *     header or `?token=` query (SNS/PagerDuty can't set custom headers —
 *     bake it into the subscription/webhook URL).
 *   - SNS 서명 검증 (default ON, `SNS_VERIFY=false`로만 해제): SNS 봉투는
 *     SigningCertURL의 AWS 인증서로 서명을 확인한 뒤에만 처리한다 — 위조
 *     봉투로 가짜 알람을 넣거나 SubscribeURL fetch를 유도할 수 없다.
 *   - PAGERDUTY_WEBHOOK_SECRET (set ⇒ required): PagerDuty 요청은 원문
 *     바디의 HMAC(X-PagerDuty-Signature v1)이 맞아야 한다.
 */
export async function POST(
  req: Request,
  { params }: { params: { provider: string } },
) {
  const provider = params.provider;
  if (!isKnownProvider(provider)) {
    return NextResponse.json(
      { error: `unknown provider "${provider}"` },
      { status: 404 },
    );
  }

  const token = process.env.INGEST_TOKEN;
  if (token) {
    const provided =
      req.headers.get("x-webhook-token") ??
      new URL(req.url).searchParams.get("token") ??
      "";
    if (!safeEqual(provided, token)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const rawText = await req.text();
  if (Buffer.byteLength(rawText) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  // PagerDuty HMAC — 원문 바디 기준이라 JSON 파싱 전에 본다. 비밀이 설정된
  // 경우: /pagerduty 경로는 서명이 필수고, 다른 경로라도 서명 헤더가 실려
  // 왔다면 맞아야 한다 (자동감지 /alarm으로 들어오는 PD 웹훅).
  const pdSecret = process.env.PAGERDUTY_WEBHOOK_SECRET;
  const pdHeader = req.headers.get("x-pagerduty-signature");
  if (pdSecret && (provider === "pagerduty" || pdHeader)) {
    const pd = verifyPagerDutySignature(rawText, pdHeader, pdSecret);
    if (!pd.ok) {
      console.error("[webhook] PagerDuty signature rejected:", pd.reason);
      return NextResponse.json(
        { error: "invalid PagerDuty signature" },
        { status: 401 },
      );
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // --- Transport: peel an SNS envelope if present -------------------------
  let payload: unknown = body;
  let fromSns = false;
  // Set when the transport layer already knows the payload shape (e.g. a
  // plain-text SNS message can only be stored as a generic alert, regardless
  // of which provider route received it).
  let providerOverride: string | undefined;

  if (isRecord(body) && typeof body.Type === "string" && "TopicArn" in body) {
    fromSns = true;
    const type = body.Type;

    // 서명부터 — 확인 전에는 봉투의 어떤 내용도 믿지 않는다 (SubscribeURL
    // fetch 포함). 로컬 테스트용 해제는 SNS_VERIFY=false.
    if (process.env.SNS_VERIFY !== "false") {
      const sig = await verifySnsMessage(body);
      if (!sig.ok) {
        console.error("[webhook] SNS signature rejected:", sig.reason);
        return NextResponse.json(
          { error: "invalid SNS signature" },
          { status: 401 },
        );
      }
    }

    if (type === "SubscriptionConfirmation") {
      const subscribeUrl = body.SubscribeURL;
      if (typeof subscribeUrl !== "string" || !isSnsSubscribeUrl(subscribeUrl)) {
        console.error("[webhook] rejected non-SNS SubscribeURL", subscribeUrl);
        return NextResponse.json(
          { error: "invalid SubscribeURL" },
          { status: 400 },
        );
      }
      try {
        await fetch(subscribeUrl);
      } catch (err) {
        console.error("[webhook] SNS subscribe confirmation failed", err);
        return NextResponse.json(
          { error: "failed to confirm subscription" },
          { status: 502 },
        );
      }
      return NextResponse.json({ ok: true, confirmed: true });
    }

    if (type === "Notification") {
      const message = body.Message;
      if (typeof message === "string") {
        try {
          payload = JSON.parse(message);
        } catch {
          // Not JSON — keep the raw text as a generic alert.
          payload = {
            title:
              (typeof body.Subject === "string" && body.Subject) ||
              "SNS Notification",
            description: message,
            source: "sns",
          };
          providerOverride = "generic";
        }
      } else {
        payload = message;
      }
    } else {
      // UnsubscribeConfirmation or anything else: acknowledge.
      return NextResponse.json({ ok: true, ignored: type });
    }
  }

  // --- Provider: normalize + ingest ---------------------------------------
  const { provider: used, alerts } = normalizeWith(
    providerOverride ?? provider,
    payload,
  );
  const results = await ingestAlerts(alerts);

  // Always 200 for SNS so it does not retry-storm on an unparseable payload.
  if (alerts.length === 0 && !fromSns) {
    return NextResponse.json(
      {
        error:
          provider === AUTO_DETECT
            ? "unrecognized payload: no provider matched"
            : `payload did not match provider "${provider}"`,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    provider: used,
    ingested: results.length,
    results,
  });
}
