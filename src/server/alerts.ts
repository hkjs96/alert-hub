import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyAll } from "@/lib/notify";
import type { AlertStatus, NormalizedAlert } from "@/lib/types";

// Map a normalized alert onto the columns we (over)write on every ingest.
// firstSeenAt/count are handled separately so they are only ever set on create
// or bumped on a genuine FIRING transition.
function toWritableData(
  n: NormalizedAlert,
): Omit<Prisma.AlertUncheckedCreateInput, "fingerprint" | "count"> {
  return {
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
    raw: (n.raw ?? undefined) as Prisma.InputJsonValue | undefined,
  };
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
 * A FIRING transition (new alert arriving as FIRING, or a known alert moving
 * from non-FIRING to FIRING) is the sole trigger for outbound notifications.
 */
export async function ingestAlert(n: NormalizedAlert): Promise<IngestResult> {
  const existing = await prisma.alert.findUnique({
    where: { fingerprint: n.fingerprint },
    select: { id: true, status: true },
  });

  const eventData = {
    status: n.status,
    stateReason: n.stateReason ?? null,
    value: n.value ?? null,
  };

  let alertId: string;
  let firedTransition: boolean;
  let created: boolean;

  if (!existing) {
    firedTransition = n.status === "FIRING";
    created = true;
    const alert = await prisma.alert.create({
      data: {
        fingerprint: n.fingerprint,
        ...toWritableData(n),
        count: 1,
        events: { create: eventData },
      },
      select: { id: true },
    });
    alertId = alert.id;
  } else {
    firedTransition = n.status === "FIRING" && existing.status !== "FIRING";
    created = false;
    await prisma.alert.update({
      where: { id: existing.id },
      data: {
        ...toWritableData(n),
        lastSeenAt: new Date(),
        count: firedTransition ? { increment: 1 } : undefined,
        events: { create: eventData },
      },
    });
    alertId = existing.id;
  }

  if (firedTransition) {
    await notifyAll(n);
  }

  return { alertId, status: n.status, firedTransition, created };
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
