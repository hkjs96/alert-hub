import { NextResponse } from "next/server";
import { normalizePayload } from "@/lib/normalize";
import { ingestAlert } from "@/server/alerts";

// The webhook needs Node APIs (Prisma) and must never be statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

async function store(payload: unknown) {
  const normalized = normalizePayload(payload);
  if (!normalized) return null;
  return ingestAlert(normalized);
}

/**
 * POST /api/webhooks/alarm
 *
 * Accepts three shapes:
 *   a. An SNS envelope ({ Type, TopicArn, ... }). SubscriptionConfirmation is
 *      auto-confirmed by fetching SubscribeURL; Notification has its `Message`
 *      (a JSON string) parsed and normalized.
 *   b. A raw CloudWatch alarm JSON (top-level AlarmName + NewStateValue).
 *   c. A generic alert JSON (title|name + optional fields).
 *
 * When INGEST_TOKEN is set, requests must carry a matching `x-webhook-token`.
 * SNS posts with `text/plain`, so the raw body is read as text and parsed here.
 */
export async function POST(req: Request) {
  const token = process.env.INGEST_TOKEN;
  if (token && req.headers.get("x-webhook-token") !== token) {
    return unauthorized();
  }

  const rawText = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // --- (a) SNS envelope ---------------------------------------------------
  if (isRecord(body) && typeof body.Type === "string" && "TopicArn" in body) {
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
      let inner: unknown = message;
      if (typeof message === "string") {
        try {
          inner = JSON.parse(message);
        } catch {
          // Not JSON — keep the raw string as a generic alert body.
          inner = {
            title: (typeof body.Subject === "string" && body.Subject) || "SNS Notification",
            description: message,
            source: "sns",
          };
        }
      }

      const result = await store(inner);
      // Always 200 so SNS does not enter a retry storm on unparseable payloads.
      return NextResponse.json({ ok: true, stored: Boolean(result), ...result });
    }

    // UnsubscribeConfirmation or anything else: acknowledge.
    return NextResponse.json({ ok: true, ignored: type });
  }

  // --- (b) / (c) direct CloudWatch or generic JSON ------------------------
  const result = await store(body);
  if (!result) {
    return NextResponse.json(
      { error: "unrecognized payload: missing title/name or AlarmName" },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, ...result });
}
