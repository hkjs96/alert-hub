/**
 * 테넌트 스코프 — 순수 함수. "이 사람이 볼 수 있는 고객사"를 배정 행에서 뽑고,
 * 알람·점검 창을 그 집합으로 거른다.
 *
 *   ADMIN · seeAll  → 전체
 *   그 외 내부 인원 → 직접 배정 + 팀 경유 배정이 걸린 고객사들
 *   open 모드(SSO 꺼짐) → 전체 (기존 동작)
 */

export type VisibleScope = { all: true } | { all: false; customerIds: string[] };

export const ALL: VisibleScope = { all: true };

/** 배정 행 하나가 가리키는 고객사 id (레벨 무관). */
export interface AssignmentScopeRow {
  customerId: string | null;
  project: { customerId: string } | null;
  service: { project: { customerId: string } } | null;
  account: { service: { project: { customerId: string } } } | null;
}

export function customerOfAssignment(a: AssignmentScopeRow): string | null {
  return a.customerId ?? a.project?.customerId ?? a.service?.project.customerId ?? a.account?.service.project.customerId ?? null;
}

export function scopeFromAssignments(rows: AssignmentScopeRow[]): VisibleScope {
  const ids = new Set<string>();
  for (const r of rows) {
    const id = customerOfAssignment(r);
    if (id) ids.add(id);
  }
  return { all: false, customerIds: [...ids].sort() };
}

export function canSeeCustomer(scope: VisibleScope, customerId: string | null | undefined): boolean {
  if (scope.all) return true;
  return Boolean(customerId) && scope.customerIds.includes(customerId as string);
}

/** Prisma where 조각. 미매핑(customerId null) 알람은 전체 스코프에서만 보인다. */
export function alertWhere(scope: VisibleScope): { customerId?: { in: string[] } } {
  return scope.all ? {} : { customerId: { in: scope.customerIds } };
}
