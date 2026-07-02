// Pure ownership-resolution logic. No DB access here — the server layer loads
// the assignment rows for a scope chain and this module decides who is
// responsible. Kept pure so the conversation's ownership scenarios are unit-
// testable without mocking Prisma.

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
  kind: string; // OWNER | DEPUTY | MEMBER (extensible)
  level: ScopeLevel;
  order?: number | null;
}

export interface Responsibility {
  /** Most specific OWNER on the chain, or null → "담당자 미지정". */
  ownerId: string | null;
  /** DEPUTYs at the most specific level that has any. */
  deputyIds: string[];
  /** MEMBER union across the whole chain, minus owner/deputies. */
  memberIds: string[];
  /** Everyone involved, deduped: owner → deputies → members. */
  allIds: string[];
}

function sortByOrder(a: AssignmentLite, b: AssignmentLite): number {
  const ao = a.order ?? Number.MAX_SAFE_INTEGER;
  const bo = b.order ?? Number.MAX_SAFE_INTEGER;
  return ao - bo;
}

/** First level (most specific → least) that has an assignment of `kind`. */
function mostSpecific(
  assignments: AssignmentLite[],
  kind: string,
): AssignmentLite[] {
  for (const level of SPECIFICITY) {
    const hits = assignments
      .filter((a) => a.level === level && a.kind === kind)
      .sort(sortByOrder);
    if (hits.length) return hits;
  }
  return [];
}

/**
 * Resolve who is responsible given every assignment attached anywhere on the
 * scope chain of one alert.
 *
 * - owner: closest OWNER wins (account → service → project → customer);
 *   a project-level owner is inherited by services/accounts below it unless a
 *   more specific OWNER row overrides it.
 * - deputies: same independent walk for DEPUTY.
 * - members: union across all levels (a member registered at the project level
 *   is "involved" for every alert under that project).
 */
export function resolveResponsibility(
  assignments: AssignmentLite[],
): Responsibility {
  const ownerId = mostSpecific(assignments, "OWNER")[0]?.contactId ?? null;

  const deputyIds = mostSpecific(assignments, "DEPUTY")
    .map((a) => a.contactId)
    .filter((id) => id !== ownerId);

  const seen = new Set<string>(
    [ownerId, ...deputyIds].filter((v): v is string => Boolean(v)),
  );
  const memberIds: string[] = [];
  for (const a of assignments
    .filter((x) => x.kind === "MEMBER")
    .sort(sortByOrder)) {
    if (!seen.has(a.contactId)) {
      seen.add(a.contactId);
      memberIds.push(a.contactId);
    }
  }

  const allIds = [
    ...(ownerId ? [ownerId] : []),
    ...deputyIds,
    ...memberIds,
  ].filter((id, i, arr) => arr.indexOf(id) === i);

  return { ownerId, deputyIds, memberIds, allIds };
}
