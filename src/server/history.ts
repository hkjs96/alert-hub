import { prisma } from "@/lib/prisma";
import { parseOwnershipSnapshot } from "@/server/org";
import {
  pickPrior,
  priorLine,
  summarize,
  type CurrentKey,
  type HistorySummary,
  type PriorItem,
  type ResolutionLite,
} from "@/lib/history";

// 해결 기록(사실 층) 쓰기·읽기. 전부 best-effort — 기록이 실패해도 전이·통지는
// 이미 끝났고, 여기서 throw 해서 그걸 되돌리면 안 된다.

const RECURRENCE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * 알람이 RESOLVED 로 갔을 때 한 행 남긴다. 발화 시각은 마지막 FIRING 이벤트,
 * 스코프는 수신 시점 스냅샷에서. 공급자 OK 면 kind="auto" 를 미리 채운다.
 */
export async function recordResolution(input: {
  alertId: string;
  via: "auto" | "manual";
  resolvedBy?: string | null;
  at?: Date;
}): Promise<{ id: string } | null> {
  try {
    const at = input.at ?? new Date();
    const alert = await prisma.alert.findUnique({
      where: { id: input.alertId },
      select: {
        id: true, title: true, namespace: true, metric: true, resource: true,
        ackedBy: true, escalationStep: true, ownershipSnapshot: true, firstSeenAt: true,
      },
    });
    if (!alert) return null;
    const fired = await prisma.alertEvent.findFirst({
      where: { alertId: alert.id, status: "FIRING" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const firedAt = fired?.createdAt ?? alert.firstSeenAt;
    const muted = (await prisma.silence.count({ where: { alertId: alert.id, createdAt: { gte: firedAt } } })) > 0;
    const snap = parseOwnershipSnapshot(alert.ownershipSnapshot);
    const row = await prisma.resolution.create({
      data: {
        alertId: alert.id,
        customerId: snap?.chain.customerId ?? null,
        serviceId: snap?.chain.serviceId ?? null,
        namespace: alert.namespace,
        metric: alert.metric,
        resource: alert.resource,
        title: alert.title,
        firedAt,
        resolvedAt: at,
        durationSec: Math.max(0, Math.round((at.getTime() - firedAt.getTime()) / 1000)),
        via: input.via,
        ackedBy: alert.ackedBy,
        resolvedBy: input.resolvedBy ?? null,
        escalationStep: alert.escalationStep,
        muted,
        kind: input.via === "auto" ? "auto" : null,
      },
      select: { id: true },
    });
    return row;
  } catch (err) {
    console.error("[history] recordResolution failed", err);
    return null;
  }
}

/** 다시 FIRING 됐을 때: 24시간 안의 마지막 해결 기록에 재발 표시. */
export async function markRecurrence(alertId: string, at: Date = new Date()): Promise<void> {
  try {
    const last = await prisma.resolution.findFirst({
      where: { alertId, recurredAt: null },
      orderBy: { resolvedAt: "desc" },
      select: { id: true, resolvedAt: true },
    });
    if (!last) return;
    if (at.getTime() - last.resolvedAt.getTime() <= RECURRENCE_WINDOW_MS) {
      await prisma.resolution.update({ where: { id: last.id }, data: { recurredAt: at } });
    }
  } catch (err) {
    console.error("[history] markRecurrence failed", err);
  }
}

export interface PriorHistory {
  items: PriorItem[];
  summary: HistorySummary;
  line: string;
}

/**
 * "이전 처리": 같은 고객사·같은 서비스의 해결 기록에서 가까운 것부터 5건.
 * 고객사 밖은 보지 않는다. 현재 알람 자신의 과거 기록은 포함한다(재발이면 그게 가장 유용).
 */
export async function findPriorResolutions(input: {
  customerId: string | null;
  serviceId: string | null;
  metric: string | null;
  resource: string | null;
  limit?: number;
}): Promise<PriorHistory> {
  const empty: PriorHistory = { items: [], summary: summarize([]), line: priorLine([]) };
  if (!input.customerId || !input.serviceId) return empty;
  try {
    const rows = await prisma.resolution.findMany({
      where: { customerId: input.customerId, serviceId: input.serviceId },
      orderBy: { resolvedAt: "desc" },
      take: 200,
    });
    const lite: ResolutionLite[] = rows.map((r) => ({
      id: r.id, alertId: r.alertId, serviceId: r.serviceId, metric: r.metric, resource: r.resource,
      title: r.title, resolvedAt: r.resolvedAt, durationSec: r.durationSec, via: r.via,
      ackedBy: r.ackedBy, resolvedBy: r.resolvedBy, escalationStep: r.escalationStep, muted: r.muted,
      kind: r.kind, note: r.note, recurredAt: r.recurredAt,
    }));
    const cur: CurrentKey = { serviceId: input.serviceId, metric: input.metric, resource: input.resource };
    const items = pickPrior(lite, cur, input.limit ?? 5);
    // 요약은 가장 좁은 티어 기준: 같은 메트릭 기록이 있으면 그것만으로, 없으면 서비스 전체.
    const narrow = lite.filter((r) => { const t = (r.metric === cur.metric && cur.metric); return t; });
    const base = narrow.length ? narrow : lite;
    return { items, summary: summarize(base), line: priorLine(base) };
  } catch (err) {
    console.error("[history] findPriorResolutions failed", err);
    return empty;
  }
}

/** 이 알람의 가장 최근 해결 기록 (상세 화면의 "어떻게 해결했나요?" 용). */
export async function latestResolutionFor(alertId: string) {
  try {
    return await prisma.resolution.findFirst({ where: { alertId }, orderBy: { resolvedAt: "desc" } });
  } catch {
    return null;
  }
}

export async function setResolutionKind(input: {
  id: string;
  kind: string;
  by: string | null;
  note?: string | null;
}): Promise<boolean> {
  try {
    await prisma.resolution.update({
      where: { id: input.id },
      data: { kind: input.kind, kindBy: input.by, ...(input.note !== undefined ? { note: input.note } : {}) },
    });
    return true;
  } catch (err) {
    console.error("[history] setResolutionKind failed", err);
    return false;
  }
}
