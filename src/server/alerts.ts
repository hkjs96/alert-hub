import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyAll } from "@/lib/notify";
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
    try {
      const alert = await prisma.alert.create({
        data: { ...toCreateData(n), events: { create: eventData } },
        select: { id: true },
      });
      const firedTransition = n.status === "FIRING";
      if (firedTransition) {
        await notifyAll(n, { alertId: alert.id });
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
    // Guarded update: only matches while the stored status is not FIRING, so
    // the transition (count++ + notify) happens exactly once even when several
    // FIRING events land concurrently.
    const transitioned = await prisma.alert.updateMany({
      where: { fingerprint: n.fingerprint, status: { not: "FIRING" } },
      data: { ...data, count: { increment: 1 } },
    });
    firedTransition = transitioned.count > 0;
    if (!firedTransition) {
      await prisma.alert.updateMany({ where: { fingerprint: n.fingerprint }, data });
    }
  } else {
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
    await notifyAll(n, { alertId });
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
    },
  });
}

export interface AlertStats {
  firing: number;
  resolved: number;
  insufficient: number;
  total: number;
}

export async function getStats(): Promise<AlertStats> {
  const [firing, resolved, insufficient, total] = await Promise.all([
    prisma.alert.count({ where: { status: "FIRING" } }),
    prisma.alert.count({ where: { status: "RESOLVED" } }),
    prisma.alert.count({ where: { status: "INSUFFICIENT_DATA" } }),
    prisma.alert.count(),
  ]);
  return { firing, resolved, insufficient, total };
}
