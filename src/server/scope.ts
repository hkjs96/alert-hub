import { prisma } from "@/lib/prisma";
import { authMode, AuthError, getCurrentUser, type CurrentUser } from "@/server/auth";
import { ALL, canSeeCustomer, scopeFromAssignments, type VisibleScope } from "@/lib/scope";

const chainSelect = {
  customerId: true,
  project: { select: { customerId: true } },
  service: { select: { project: { select: { customerId: true } } } },
  account: { select: { service: { select: { project: { select: { customerId: true } } } } } },
} as const;

/** 인원 id 기준 스코프 (Slack 버튼처럼 세션이 없는 경로용). */
export async function scopeForContact(contact: {
  id: string;
  role: string;
  seeAll?: boolean;
  customerId?: string | null;
}): Promise<VisibleScope> {
  // 고객사 담당자는 자기 고객사만 — 배정·역할과 무관.
  if (contact.customerId) return { all: false, customerIds: [contact.customerId] };
  if (contact.role === "ADMIN" || contact.seeAll) return ALL;
  const [direct, memberships] = await Promise.all([
    prisma.assignment.findMany({ where: { contactId: contact.id }, select: chainSelect }),
    prisma.teamMember.findMany({
      where: { contactId: contact.id },
      select: { team: { select: { assignments: { select: chainSelect } } } },
    }),
  ]);
  return scopeFromAssignments([...direct, ...memberships.flatMap((m) => m.team.assignments)]);
}

/**
 * 현재 세션의 스코프. open 모드는 전체. SSO 모드에서 세션이 없으면(미들웨어가
 * 이미 막았겠지만) 아무것도 못 본다.
 */
export async function getVisibleScope(user?: CurrentUser | null): Promise<VisibleScope> {
  if (authMode() === "open") return ALL;
  const u = user === undefined ? await getCurrentUser() : user;
  if (!u || u.status !== "ACTIVE") return { all: false, customerIds: [] };
  return scopeForContact({ id: u.id, role: u.role, seeAll: u.seeAll, customerId: u.customerId });
}

/** 액션 가드: 알람이 내 스코프 밖이면 forbidden. open 모드는 통과. */
export async function assertAlertInScope(alertId: string): Promise<void> {
  if (authMode() === "open") return;
  const scope = await getVisibleScope();
  if (scope.all) return;
  const a = await prisma.alert.findUnique({ where: { id: alertId }, select: { customerId: true } });
  if (!a || !canSeeCustomer(scope, a.customerId)) {
    throw new AuthError("담당 고객사 밖의 알람입니다", "forbidden");
  }
}
