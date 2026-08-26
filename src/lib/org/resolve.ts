// Pure ownership-resolution logic. No DB access here — the server layer loads
// the assignment rows for a scope chain and this module decides who is
// responsible. Kept pure so the conversation's ownership scenarios are unit-
// testable without mocking Prisma.
//
// v0.3 model (see docs/requirements.html §4): 등록(who belongs) and
// 순서(who is notified first) are separate concerns. There is no OWNER/DEPUTY/
// MEMBER label — an assignment is just a contact sitting at one scope with an
// `order`, and 1순위 is simply order[0].

export type ScopeLevel = "account" | "service" | "project" | "customer";

/** Most specific first — the walk order for "closest wins". */
export const SPECIFICITY: ScopeLevel[] = [
  "account",
  "service",
  "project",
  "customer",
];

export interface AssignmentLite {
  contactId: string;
  level: ScopeLevel;
  /** Position within its own level. 0 = 1순위. */
  order: number;
}

export interface Responsibility {
  /**
   * The level whose list was adopted, or null when nothing is registered
   * anywhere on the chain ("담당자 미지정").
   */
  level: ScopeLevel | null;
  /** Adopted level's contacts, in notification order. 1순위 first. */
  order: string[];
  /** order[0] — the person the dashboard shows as 담당 and Slack pings first. */
  primaryId: string | null;
}

const EMPTY: Responsibility = { level: null, order: [], primaryId: null };

function byOrder(a: AssignmentLite, b: AssignmentLite): number {
  return a.order - b.order;
}

/**
 * Resolve who is responsible given every assignment attached anywhere on the
 * scope chain of one alert.
 *
 * The rule is "최구체 직접등록 레벨 채택": walk account → service → project →
 * customer and take the **whole ordered list** of the first level that has any
 * rows. Levels are never merged — a service-level list fully replaces the
 * customer-level one rather than appending to it, so a team that takes over a
 * service does not silently inherit the parent's escalation tail.
 */
export function resolveResponsibility(
  assignments: AssignmentLite[],
): Responsibility {
  for (const level of SPECIFICITY) {
    const hits = assignments.filter((a) => a.level === level);
    if (!hits.length) continue;

    const order = [...hits].sort(byOrder).map((a) => a.contactId);
    // Same person registered twice at one level would double-notify.
    const deduped = order.filter((id, i) => order.indexOf(id) === i);
    return { level, order: deduped, primaryId: deduped[0] ?? null };
  }
  return EMPTY;
}

/**
 * The order that a level *would* inherit from above, for the "이 단계는 비어
 * 있고 실제로는 이게 적용됩니다" hint on the escalation screen.
 *
 * Only ancestors are considered — inheritance flows downward only, so a
 * project must never be shown its own services' or accounts' rows as if they
 * were inherited.
 */
export function inheritedOrderFor(
  level: Exclude<ScopeLevel, "account">,
  assignments: AssignmentLite[],
): Responsibility {
  const ancestors: ScopeLevel[] =
    level === "service"
      ? ["project", "customer"]
      : level === "project"
        ? ["customer"]
        : [];

  for (const ancestor of ancestors) {
    const hits = assignments.filter((a) => a.level === ancestor);
    if (!hits.length) continue;
    const order = [...hits].sort(byOrder).map((a) => a.contactId);
    const deduped = order.filter((id, i) => order.indexOf(id) === i);
    return { level: ancestor, order: deduped, primaryId: deduped[0] ?? null };
  }
  return EMPTY;
}

/** UI label for the level a resolution was adopted from. */
export function levelLabel(level: ScopeLevel | null): string {
  if (!level) return "미배정";
  return { account: "계정", service: "서비스", project: "프로젝트", customer: "고객사" }[
    level
  ];
}
