import { prisma } from "@/lib/prisma";
import { parseOwnershipSnapshot } from "@/server/org";
import type { SilenceRow, SilenceScope } from "@/lib/silence";

/** 지금 유효한(진행 중) 뮤트만 — 대시보드 칩·크론 판정용. */
export async function getActiveSilences(now = new Date()): Promise<SilenceRow[]> {
  return prisma.silence.findMany({
    where: { revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
  });
}

/**
 * 통지 직전 게이트. 실패는 "뮤트 아님"으로 삼킨다 — 뮤트 판정이 죽어서
 * 통지까지 죽는 것보다, 뮤트가 한 번 뚫리는 쪽이 덜 위험하다 (fail-open).
 */
export async function findActiveSilence(
  scope: SilenceScope,
  now = new Date(),
): Promise<SilenceRow | null> {
  const or: object[] = [];
  if (scope.alertId) or.push({ alertId: scope.alertId });
  if (scope.serviceId) or.push({ serviceId: scope.serviceId });
  if (scope.projectId) or.push({ projectId: scope.projectId });
  if (scope.customerId) or.push({ customerId: scope.customerId });
  if (or.length === 0) return null;
  try {
    return await prisma.silence.findFirst({
      where: {
        revokedAt: null,
        startsAt: { lte: now },
        endsAt: { gt: now },
        OR: or,
      },
      orderBy: { endsAt: "desc" },
    });
  } catch (err) {
    console.error("[silence] lookup failed — notifying anyway", err);
    return null;
  }
}

/** 저장된 알람 행에서 뮤트 매칭 좌표를 만든다 (스냅샷 체인 우선). */
export function scopeOfStoredAlert(alert: {
  id: string;
  ownershipSnapshot: unknown;
}): SilenceScope {
  const snap = parseOwnershipSnapshot(alert.ownershipSnapshot);
  return {
    alertId: alert.id,
    customerId: snap?.chain.customerId ?? null,
    projectId: snap?.chain.projectId ?? null,
    serviceId: snap?.chain.serviceId ?? null,
  };
}

/** 점검 · 뮤트 일람 — 관계를 함께 읽어 스코프 이름을 그린다. */
export async function getSilencesForDisplay() {
  return prisma.silence.findMany({
    include: {
      alert: { select: { id: true, title: true } },
      customer: { select: { name: true } },
      project: { select: { name: true, customer: { select: { name: true } } } },
      service: {
        select: {
          name: true,
          project: {
            select: { name: true, customer: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}
