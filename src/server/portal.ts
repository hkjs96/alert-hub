import { prisma } from "@/lib/prisma";
import { AuthError, getCurrentUser, type CurrentUser } from "@/server/auth";
import { hasGrant, parseGrants, type PortalGrant } from "@/lib/portal";

// 고객사 포털의 권한 게이트. 세 겹:
//   ① 고객사 계정인가 (내부 인원·관리자 액션과 함수를 공유하지 않는다)
//   ② 이 고객사에 그 쓰기 권한이 켜져 있나 (MSP 가 고객사마다 설정)
//   ③ 수정 대상이 정말 이 고객사 것인가 (폼이 보낸 id 는 믿지 않는다)
// 모든 포털 액션은 첫 줄에서 requirePortal(grant) 을 부르고, 대상 id 를 쓰기
// 전에 assertOwned*() 로 확인한다.

export interface PortalContext {
  user: CurrentUser;
  customerId: string;
  customerName: string;
  grants: PortalGrant[];
}

/**
 * 고객사 계정 확인 + (grant 를 주면) 그 쓰기 권한 확인. 둘 중 하나라도 아니면
 * AuthError. 내부 인원(관리자 포함)은 여기 통과하지 못한다 — 관리자는 관리자
 * 화면의 액션을 쓴다.
 */
export async function requirePortal(grant?: PortalGrant): Promise<PortalContext> {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") throw new AuthError("로그인이 필요합니다", "unauthenticated");
  if (!user.customerId) throw new AuthError("고객사 담당자 계정만 사용할 수 있습니다", "forbidden");
  const customer = await prisma.customer.findUnique({
    where: { id: user.customerId },
    select: { id: true, name: true, portalGrants: true, loginDomains: true },
  });
  if (!customer || !(customer.loginDomains ?? "").trim()) {
    throw new AuthError("이 고객사는 로그인이 꺼져 있습니다", "forbidden");
  }
  if (grant && !hasGrant(customer.portalGrants, grant)) {
    throw new AuthError("이 항목은 읽기 전용입니다 — 담당 MSP 엔지니어에게 요청하세요", "forbidden");
  }
  return {
    user,
    customerId: customer.id,
    customerName: customer.name,
    grants: parseGrants(customer.portalGrants),
  };
}

const NOT_MINE = () => new AuthError("우리 회사의 항목이 아닙니다", "forbidden");

/** 담당자: 이 고객사 소속이어야 한다. */
export async function assertOwnedContact(customerId: string, id: string): Promise<{ name: string }> {
  const row = await prisma.contact.findUnique({ where: { id }, select: { customerId: true, name: true } });
  if (!row || row.customerId !== customerId) throw NOT_MINE();
  return { name: row.name };
}

/** 점검 창: 고객사 직접 · 이 고객사의 프로젝트/서비스 · 이 고객사 알람 중 하나여야 한다. */
export async function assertOwnedSilence(customerId: string, id: string): Promise<{ reason: string }> {
  const row = await prisma.silence.findUnique({
    where: { id },
    select: {
      reason: true,
      customerId: true,
      project: { select: { customerId: true } },
      service: { select: { project: { select: { customerId: true } } } },
      alert: { select: { customerId: true } },
    },
  });
  const owner =
    row?.customerId ?? row?.project?.customerId ?? row?.service?.project.customerId ?? row?.alert?.customerId ?? null;
  if (!row || owner !== customerId) throw NOT_MINE();
  return { reason: row.reason };
}

/** 통지 채널: 고객사 직접 또는 이 고객사의 프로젝트/서비스에 붙은 것이어야 한다. */
export async function assertOwnedChannel(customerId: string, id: string): Promise<{ label: string }> {
  const row = await prisma.notifyChannel.findUnique({
    where: { id },
    select: {
      label: true,
      customerId: true,
      project: { select: { customerId: true } },
      service: { select: { project: { select: { customerId: true } } } },
    },
  });
  const owner = row?.customerId ?? row?.project?.customerId ?? row?.service?.project.customerId ?? null;
  if (!row || owner !== customerId) throw NOT_MINE();
  return { label: row.label };
}

/**
 * 점검 창·채널을 만들 때 고르는 범위(고객사/프로젝트/서비스)가 이 고객사 것인지.
 * 반환값은 Prisma where 조각이라 호출부가 그대로 쓴다.
 */
export async function assertOwnedScope(
  customerId: string,
  level: string,
  scopeId: string,
): Promise<{ customerId: string } | { projectId: string } | { serviceId: string }> {
  if (level === "customer") {
    if (scopeId !== customerId) throw NOT_MINE();
    return { customerId };
  }
  if (level === "project") {
    const p = await prisma.project.findUnique({ where: { id: scopeId }, select: { customerId: true } });
    if (!p || p.customerId !== customerId) throw NOT_MINE();
    return { projectId: scopeId };
  }
  if (level === "service") {
    const s = await prisma.service.findUnique({
      where: { id: scopeId },
      select: { project: { select: { customerId: true } } },
    });
    if (!s || s.project.customerId !== customerId) throw NOT_MINE();
    return { serviceId: scopeId };
  }
  throw new AuthError("범위가 잘못됐습니다", "forbidden");
}

/** 감사 로그 한 줄. 기록 실패가 작업을 되돌리지 않는다. */
export async function audit(
  ctx: PortalContext,
  entry: { action: string; targetId?: string | null; target?: string | null; detail?: string | null },
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        actorEmail: ctx.user.email,
        customerId: ctx.customerId,
        action: entry.action,
        targetId: entry.targetId ?? null,
        target: entry.target ?? null,
        detail: entry.detail ?? null,
      },
    });
  } catch (err) {
    console.error("[portal] audit write failed", err);
  }
}
