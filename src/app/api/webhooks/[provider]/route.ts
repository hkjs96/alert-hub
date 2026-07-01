import { NextResponse } from "next/server";
import { isRecord } from "@/lib/normalize";
import { AUTO_DETECT, isKnownProvider, normalizeWith } from "@/lib/providers";
import { ingestAlerts } from "@/server/alerts";

// Needs Node APIs (Prisma) and must never be statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/<provider>
 *
 * Two layers:
 *   1. Transport — an SNS envelope ({ Type, TopicArn }) is peeled here:
 *      SubscriptionConfirmation is auto-confirmed via SubscribeURL; a
 *      Notification has its `Message` (a JSON string) parsed into the inner
 *      payload. Otherwise the raw body is the payload.
 *   2. Provider — the URL segment picks the parser:
 *        /grafana /prometheus /pagerduty /cloudwatch /generic  → that parser
 *        /alarm                                                → auto-detect
 *
 * When INGEST_TOKEN is set, requests must carry a matching `x-webhook-token`.
 * (Per-source signature verification — SNS/PagerDuty — is a later step.)
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
  if (token && req.headers.get("x-webhook-token") !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rawText = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // --- Transport: peel an SNS envelope if present -------------------------
  let payload: unknown = body;
  let fromSns = false;

  if (isRecord(body) && typeof body.Type === "string" && "TopicArn" in body) {
    fromSns = true;
    const type = body.Type;

    if (type === "SubscriptionConfirmation") {
      const subscribeUrl = body.SubscribeURL;
      if (typeof subscribeUrl === "string") {
        try {
          await fetch(subscribeUrl);
        } catch (err) {
          console.error("[webhook] SNS subscribe confirmation failed", err);
          return NextResponse.json(
            { error: "failed to confirm subscription" },
            { status: 502 },
          );
        }
      }
      return NextResponse.json({ ok: true, confirmed: true });
    }

    if (type === "Notification") {
      const message = body.Message;
      if (typeof message === "string") {
        try {
          payload = JSON.parse(message);
        } catch {
          payload = {
            title:
              (typeof body.Subject === "string" && body.Subject) ||
              "SNS Notification",
            description: message,
            source: "sns",
          };
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
  const { provider: used, alerts } = normalizeWith(provider, payload);
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
