import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { NotifyContext } from "@/lib/notify";
import { digestWindowSeconds, enqueueAndSend } from "@/server/notify-queue";
import { buildOwnershipSnapshot, getOwnershipByAwsAccount } from "@/server/org";
import { findActiveSilence } from "@/server/silences";
import type { SilenceScope } from "@/lib/silence";
import type { AlertStatus, NormalizedAlert } from "@/lib/types";

// Columns written when an alert is first created. Optional fields land as
// null; count starts at 1.
function toCreateData(n: NormalizedAlert): Prisma.AlertUncheckedCreateInput {
  return {
    fingerprint: n.fingerprint,
    title: n.title,
    description: n.description ?? null,
    source: n.source,
    severity: n.severity,
    status: n.status,
    resource: n.resource ?? null,
    metric: n.metric ?? null,
    namespace: n.namespace ?? null,
    value: n.value ?? null,
    threshold: n.threshold ?? null,
    comparison: n.comparison ?? null,
    region: n.region ?? null,
    accountId: n.accountId ?? null,
    stateReason: n.stateReason ?? null,
    count: 1,
    raw: (n.raw ?? undefined) as Prisma.InputJsonValue | undefined,
  };
}

// Columns written on follow-up events. Absent values stay `undefined` so
// Prisma SKIPS them: a sparse follow-up (e.g. a CloudWatch OK resend without
// Trigger) must not erase the enrichment the FIRING payload carried
// (metric/namespace/threshold/region/...). severity likewise only moves off
// the stored value when the new payload actually knows one.
function toUpdateData(n: NormalizedAlert) {
  return {
    title: n.title,
    description: n.description ?? undefined,
    source: n.source,
    severity: n.severity === "UNKNOWN" ? undefined : n.severity,
    status: n.status,
    resource: n.resource ?? undefined,
    metric: n.metric ?? undefined,
    namespace: n.namespace ?? undefined,
    value: n.value ?? undefined,
    threshold: n.threshold ?? undefined,
    comparison: n.comparison ?? undefined,
    region: n.region ?? undefined,
    accountId: n.accountId ?? undefined,
    stateReason: n.stateReason ?? undefined,
    // raw always reflects the latest payload; history lives in AlertEvent.
    raw: (n.raw ?? undefined) as Prisma.InputJsonValue | undefined,
    lastSeenAt: new Date(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

/**
 * One resolution, two consumers: the Slack context (who to name) and the
 * 수신 시점 스냅샷 frozen onto the Alert row (BR-05). Resolution errors are
 * logged and swallowed — a broken org lookup must never cost the notification
 * or the ingest itself.
 */
interface IngestOwnership {
  assignees?: NonNullable<NotifyContext["assignees"]>;
  snapshot?: Prisma.InputJsonValue;
  /** 뮤트 매칭 좌표 — 알람이 속한 체인 id들 (미매핑이면 없음). */
  scope?: Omit<SilenceScope, "alertId">;
  /** "고객사 › 프로젝트 › 서비스" — 다이제스트 헤더용. */
  chainLabel?: string;
}

async function resolveIngestOwnership(
  n: NormalizedAlert,
): Promise<IngestOwnership> {
  if (!n.accountId) return {};
  try {
    const ownership = await getOwnershipByAwsAccount(n.accountId);
    if (!ownership) return {}; // unmapped — nothing to freeze
    const out: IngestOwnership = {
      snapshot: buildOwnershipSnapshot(ownership) as unknown as Prisma.InputJsonValue,
      scope: {
        customerId: ownership.chain.customer.id,
        projectId: ownership.chain.project.id,
        serviceId: ownership.chain.service.id,
      },
      chainLabel: `${ownership.chain.customer.name} › ${ownership.chain.project.name} › ${ownership.chain.service.name}`,
    };
    if (ownership.contacts.length > 0) {
      out.assignees = ownership.contacts.map((c) => ({
        name: c.name,
        slackId: c.slackId,
        email: c.email,
        phone: c.phone,
      }));
    }
    return out;
  } catch (err) {
    console.error("[ingest] ownership resolution failed", err);
    return {};
  }
}

function toNotifyContext(alertId: string, own: IngestOwnership): NotifyContext {
  const ctx: NotifyContext = { alertId };
  if (own.assignees) ctx.assignees = own.assignees;
  if (own.chainLabel) ctx.chainLabel = own.chainLabel;
  return ctx;
}

/**
 * FIRING 전이 팬아웃 — 단, 뮤트(점검 창)가 덮고 있으면 통지만 조용히
 * 생략한다. 수집·이벤트·화면은 이미 위에서 다 처리됐다 (BR: 뮤트는 통지와
 * 에스컬레이션만 멈춘다).
 */
async function notifyUnlessSilenced(
  alertId: string,
  n: NormalizedAlert,
  own: IngestOwnership,
): Promise<void> {
  const silence = await findActiveSilence({ alertId, ...own.scope });
  if (silence) {
    console.info(
      `[notify] alert ${alertId} muted by silence ${silence.id} (${silence.reason}) — skipping fan-out`,
    );
    return;
  }
  // 아웃박스 경유: 채널별 잡 생성 + 인라인 1회 시도, 실패분은 틱이 재시도.
  // 서비스가 식별되면 Slack은 묶음 창(기본 60초)만큼 미뤄 다이제스트 후보로.
  await enqueueAndSend(alertId, n, toNotifyContext(alertId, own), {
    groupKey: own.scope?.serviceId ? `service:${own.scope.serviceId}` : undefined,
    digestDelaySeconds: digestWindowSeconds(),
  });
}

export interface IngestResult {
  alertId: string;
  status: AlertStatus;
  /** True when this ingest moved the alert into FIRING from a non-FIRING state. */
  firedTransition: boolean;
  created: boolean;
}

/**
 * Dedup + persist a normalized alert.
 *
 * - New fingerprint  => create the Alert and its first AlertEvent.
 * - Known fingerprint => update fields, append an AlertEvent (append-only
 *   history), and bump `count` only when this is a transition INTO FIRING.
 *
 * Concurrency: two racing requests for the same new fingerprint both pass the
 * findUnique check, but only one create wins; the loser hits the unique
 * constraint (P2002) and falls through to the update path instead of crashing.
 * The FIRING transition itself is decided by a status-guarded updateMany, so
 * exactly one concurrent request wins the count++/notify even under a race.
 */
export async function ingestAlert(n: NormalizedAlert): Promise<IngestResult> {
  const eventData = {
    status: n.status,
    stateReason: n.stateReason ?? null,
    value: n.value ?? null,
  };

  const existing = await prisma.alert.findUnique({
    where: { fingerprint: n.fingerprint },
    select: { id: true },
  });

  if (!existing) {
    // 첫 접수 시점의 담당을 함께 얼린다 — 이 순서가 화면의 "담당"이 된다.
    const own = await resolveIngestOwnership(n);
    try {
      const alert = await prisma.alert.create({
        data: {
          ...toCreateData(n),
          ownershipSnapshot: own.snapshot,
          events: { create: eventData },
        },
        select: { id: true },
      });
      const firedTransition = n.status === "FIRING";
      if (firedTransition) {
        await notifyUnlessSilenced(alert.id, n, own);
      }
      return { alertId: alert.id, status: n.status, firedTransition, created: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Lost the create race — the row exists now; treat as an update.
    }
  }

  return updateExisting(n, eventData, existing?.id);
}

async function updateExisting(
  n: NormalizedAlert,
  eventData: { status: string; stateReason: string | null; value: string | null },
  knownId?: string,
): Promise<IngestResult> {
  const data = toUpdateData(n);
  let firedTransition = false;

  if (n.status === "FIRING") {
    // Guarded update: only matches while the stored status is neither FIRING
    // nor ACKNOWLEDGED, so the transition (count++ + notify) happens exactly
    // once even when several FIRING events land concurrently. ACKNOWLEDGED is
    // excluded because an ack is sticky (2c): Prometheus/Grafana re-send a
    // still-firing alarm on an interval, and each resend must not un-ack the
    // incident or re-page — only resolve/OK moves it on.
    const transitioned = await prisma.alert.updateMany({
      where: {
        fingerprint: n.fingerprint,
        status: { notIn: ["FIRING", "ACKNOWLEDGED"] },
      },
      // 재발화는 새 인시던트: 에스컬레이션 사다리도 1순위부터 다시 시작한다.
      data: { ...data, count: { increment: 1 }, escalationStep: 1, escalatedAt: null },
    });
    firedTransition = transitioned.count > 0;
    if (!firedTransition) {
      // Already FIRING (refresh fields) or ACKNOWLEDGED (keep the ack): the
      // payload's fields still apply, the status does not.
      await prisma.alert.updateMany({
        where: { fingerprint: n.fingerprint },
        data: { ...data, status: undefined },
      });
    }
  } else if (n.status === "INSUFFICIENT_DATA") {
    // NoData flaps must not clear a human's ack either.
    const moved = await prisma.alert.updateMany({
      where: { fingerprint: n.fingerprint, status: { not: "ACKNOWLEDGED" } },
      data,
    });
    if (moved.count === 0) {
      await prisma.alert.updateMany({
        where: { fingerprint: n.fingerprint },
        data: { ...data, status: undefined },
      });
    }
  } else {
    // RESOLVED (or a provider-side ACKNOWLEDGED, e.g. PagerDuty) applies from
    // any state — resolve/OK is exactly what releases an ack.
    await prisma.alert.updateMany({ where: { fingerprint: n.fingerprint }, data });
  }

  let alertId = knownId;
  if (!alertId) {
    const alert = await prisma.alert.findUnique({
      where: { fingerprint: n.fingerprint },
      select: { id: true },
    });
    if (!alert) {
      throw new Error(`alert ${n.fingerprint} vanished mid-ingest`);
    }
    alertId = alert.id;
  }

  await prisma.alertEvent.create({ data: { alertId, ...eventData } });

  if (firedTransition) {
    const own = await resolveIngestOwnership(n);
    if (own.snapshot) {
      // Re-fire refreshes the snapshot: the frozen order is whichever list was
      // actually notified for the current incident, not the very first one.
      await prisma.alert.updateMany({
        where: { fingerprint: n.fingerprint },
        data: { ownershipSnapshot: own.snapshot },
      });
    }
    await notifyUnlessSilenced(alertId, n, own);
  }

  return { alertId, status: n.status, firedTransition, created: false };
}

/**
 * Ingest a batch (Prometheus/Grafana send many alerts per POST). Sequential on
 * purpose: keeps event ordering sane and avoids a connection-pool spike for a
 * large batch. Failures are isolated per alert so one bad entry can't sink the
 * rest of the batch.
 */
export async function ingestAlerts(alerts: NormalizedAlert[]): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const alert of alerts) {
    try {
      results.push(await ingestAlert(alert));
    } catch (err) {
      console.error(`[ingest] failed for ${alert.fingerprint}`, err);
    }
  }
  return results;
}

/**
 * 저장된 알람 행을 다시 팬아웃한다 — 점검 창 종료 시 "남은 FIRING 즉시
 * 발송" 경로. 담당은 지금 기준으로 다시 해석하고, 다른 창이 아직 덮고
 * 있으면 notifyUnlessSilenced가 알아서 삼킨다. 여러 건이 남았으면 묶음
 * 창에서 다시 다이제스트로 합쳐진다.
 */
export async function refireNotifications(row: {
  id: string;
  fingerprint: string;
  title: string;
  description: string | null;
  source: string;
  severity: string;
  resource: string | null;
  metric: string | null;
  namespace: string | null;
  value: string | null;
  threshold: number | null;
  comparison: string | null;
  region: string | null;
  accountId: string | null;
  stateReason: string | null;
}): Promise<void> {
  const n: NormalizedAlert = {
    fingerprint: row.fingerprint,
    title: row.title,
    description: row.description ?? undefined,
    source: row.source,
    severity: row.severity,
    status: "FIRING",
    resource: row.resource ?? undefined,
    metric: row.metric ?? undefined,
    namespace: row.namespace ?? undefined,
    value: row.value ?? undefined,
    threshold: row.threshold ?? undefined,
    comparison: row.comparison ?? undefined,
    region: row.region ?? undefined,
    accountId: row.accountId ?? undefined,
    stateReason: row.stateReason ?? undefined,
  };
  const own = await resolveIngestOwnership(n);
  await notifyUnlessSilenced(row.id, n, own);
}

// --- Read helpers used by the dashboard ------------------------------------

export async function getAlerts(status?: AlertStatus) {
  return prisma.alert.findMany({
    where: status ? { status } : undefined,
    orderBy: { lastSeenAt: "desc" },
  });
}

export async function getAlert(id: string) {
  return prisma.alert.findUnique({
    where: { id },
    include: {
      events: { orderBy: { createdAt: "desc" } },
      notifications: { orderBy: { createdAt: "desc" } },
      // 재시도 대기 중인 아웃박스 잡 — 통지 이력에 "재시도 n/5"로 보인다.
      notifyJobs: {
        where: { status: "pending" },
        orderBy: { nextAttemptAt: "asc" },
      },
    },
  });
}

// 스탯 타일 수치. 대시보드가 "현재 필터 기준"으로 메모리에서 계산한다 —
// 전역 count 쿼리를 쓰면 필터 뷰에서 전체 수치가 보여 오독을 낳는다는 것이
// 페르소나 검증에서 확인됐다.
export interface AlertStats {
  firing: number;
  acknowledged: number;
  resolved: number;
  insufficient: number;
  total: number;
}
