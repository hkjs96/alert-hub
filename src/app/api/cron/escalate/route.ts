import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyAll } from "@/lib/notify";
import { recordNotifications } from "@/server/alerts";
import { parseOwnershipSnapshot } from "@/server/org";
import { getActiveSilences, scopeOfStoredAlert } from "@/server/silences";
import { matchSilence } from "@/lib/silence";
import { ackMinutesFromEnv, nextEscalation } from "@/lib/escalation";
import type { NormalizedAlert } from "@/lib/types";

export const dynamic = "force-dynamic";

// 자동 에스컬레이션 틱 (Phase 3). 외부 스케줄러(crontab, Vercel Cron, EventBridge
// Scheduler…)가 1~수 분 간격으로 GET을 쏘는 것으로 동작한다 — Next 앱 안에는
// 상주 워커가 없으므로 시간은 바깥에서 흘려보낸다.
//
// 실제 판정은 src/lib/escalation.ts의 순수 함수가 한다. 이 라우트는 인증,
// FIRING 스캔, 낙관적 선점(guarded updateMany), 이벤트 append, 통지만 담당한다.

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

type AlertRow = Awaited<ReturnType<typeof prisma.alert.findMany>>[number];

/** Rebuild the notifier-facing shape from a stored row. */
function toNormalized(a: AlertRow): NormalizedAlert {
  return {
    fingerprint: a.fingerprint,
    title: a.title,
    description: a.description ?? undefined,
    source: a.source,
    severity: a.severity,
    status: "FIRING",
    resource: a.resource ?? undefined,
    metric: a.metric ?? undefined,
    namespace: a.namespace ?? undefined,
    value: a.value ?? undefined,
    threshold: a.threshold ?? undefined,
    comparison: a.comparison ?? undefined,
    region: a.region ?? undefined,
    accountId: a.accountId ?? undefined,
    stateReason: a.stateReason ?? undefined,
  };
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // 비밀 없이 열어두면 아무나 에스컬레이션을 앞당길 수 있다 — 미설정이면
    // 기능 자체를 끈 것으로 취급한다.
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(req.url).searchParams.get("secret") ??
    "";
  if (!safeEqual(provided, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ackMinutes = ackMinutesFromEnv();
  const now = new Date();
  const [firing, silences] = await Promise.all([
    prisma.alert.findMany({ where: { status: "FIRING" } }),
    getActiveSilences(now),
  ]);

  let escalated = 0;
  let muted = 0;
  for (const alert of firing) {
    // 뮤트 중엔 에스컬레이션도 멈춘다. step은 건드리지 않으므로 뮤트가
    // 끝나면 다음 틱에 밀린 단계가 즉시 이어진다 ("통지 재개").
    if (matchSilence(silences, scopeOfStoredAlert(alert), now)) {
      muted += 1;
      continue;
    }
    const snap = parseOwnershipSnapshot(alert.ownershipSnapshot);
    if (!snap || snap.order.length === 0) continue;

    const idx = nextEscalation(
      {
        status: alert.status,
        escalationStep: alert.escalationStep,
        escalatedAt: alert.escalatedAt,
        firedAt: snap.capturedAt ?? null,
        orderLength: snap.order.length,
      },
      now,
      ackMinutes,
    );
    if (idx === null) continue;

    // 낙관적 선점: 겹쳐 도는 틱이나 그 사이 들어온 ack/resolve가 있으면 이
    // 갱신이 0건이 되고, 이 알람은 이번 틱에서 조용히 건너뛴다.
    const claimed = await prisma.alert.updateMany({
      where: {
        id: alert.id,
        status: "FIRING",
        escalationStep: alert.escalationStep,
      },
      data: { escalationStep: idx + 1, escalatedAt: now },
    });
    if (claimed.count === 0) continue;

    // 연락처는 통지 시점에 새로 읽는다 — 스냅샷은 '누구·어떤 순서'를 얼리는
    // 것이지 연락 수단까지 얼리는 게 아니다. 삭제된 사람은 이름만 남는다.
    const target = snap.order[idx];
    const contact = await prisma.contact.findUnique({
      where: { id: target.contactId },
    });
    const assignee = {
      name: contact?.name ?? target.name,
      slackId: contact?.slackId ?? null,
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
    };

    await prisma.alertEvent.create({
      data: {
        alertId: alert.id,
        status: "ESCALATED",
        stateReason: `${ackMinutes}분 내 ack 없음 → ${idx + 1}순위 ${assignee.name}에게 자동 에스컬레이션`,
      },
    });
    const ctx = {
      alertId: alert.id,
      assignees: [assignee],
      escalationStep: idx + 1,
    };
    const outcomes = await notifyAll(toNormalized(alert), ctx);
    await recordNotifications(alert.id, ctx, outcomes);
    escalated += 1;
  }

  return NextResponse.json({ checked: firing.length, escalated, muted, ackMinutes });
}
