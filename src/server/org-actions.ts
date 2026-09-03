"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { ScopeLevel } from "@/lib/org/resolve";

// Mutations behind the admin UI. Plain server actions driven by <form> posts —
// no client JS needed. Each action revalidates the page it was fired from
// (the form carries the current path in a hidden `back` field).

function backPath(formData: FormData, fallback: string): string {
  const raw = formData.get("back");
  return typeof raw === "string" && raw.startsWith("/") ? raw : fallback;
}

/**
 * revalidatePath ignores a path that carries a query string, which silently
 * leaves the router cache stale — the escalation page's `back` includes its
 * scope selection as a query, so strip it before revalidating.
 */
function revalidateBack(formData: FormData, fallback: string) {
  const back = backPath(formData, fallback);
  const q = back.indexOf("?");
  revalidatePath(q === -1 ? back : back.slice(0, q));
}

function requireString(formData: FormData, key: string): string {
  const v = formData.get(key);
  if (typeof v !== "string" || !v.trim()) throw new Error(`missing ${key}`);
  return v.trim();
}

function optionalString(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// --- Customers ---------------------------------------------------------------

/**
 * redirectTo에 "__ID__" 자리표시가 있으면 방금 만든 행의 id로 바꿔 이동한다 —
 * 온보딩 위저드(O3)가 생성 직후 다음 단계로 이어지는 방법.
 */
function redirectWithId(formData: FormData, id: string) {
  const to = optionalString(formData, "redirectTo");
  if (to && to.startsWith("/")) redirect(to.replace("__ID__", id));
}

export async function createCustomer(formData: FormData) {
  const customer = await prisma.customer.create({
    data: {
      name: requireString(formData, "name"),
      isInternal: formData.get("isInternal") === "on",
    },
  });
  revalidatePath("/admin/customers");
  redirectWithId(formData, customer.id);
}

export async function deleteCustomer(formData: FormData) {
  await prisma.customer.delete({ where: { id: requireString(formData, "id") } });
  revalidatePath("/admin/customers");
}

// --- Projects ------------------------------------------------------------------

export async function createProject(formData: FormData) {
  const project = await prisma.project.create({
    data: {
      name: requireString(formData, "name"),
      customerId: requireString(formData, "customerId"),
    },
  });
  revalidateBack(formData, "/admin/customers");
  redirectWithId(formData, project.id);
}

export async function deleteProject(formData: FormData) {
  await prisma.project.delete({ where: { id: requireString(formData, "id") } });
  revalidateBack(formData, "/admin/customers");
}

// --- Services ------------------------------------------------------------------

export async function createService(formData: FormData) {
  const service = await prisma.service.create({
    data: {
      name: requireString(formData, "name"),
      projectId: requireString(formData, "projectId"),
    },
  });
  revalidateBack(formData, "/admin/customers");
  redirectWithId(formData, service.id);
}

export async function deleteService(formData: FormData) {
  await prisma.service.delete({ where: { id: requireString(formData, "id") } });
  revalidateBack(formData, "/admin/customers");
}

// --- AWS account mappings --------------------------------------------------------

export async function createAccountMap(formData: FormData) {
  const accountId = requireString(formData, "accountId");
  if (!/^\d{12}$/.test(accountId)) {
    throw new Error("AWS account id must be 12 digits");
  }
  await prisma.awsAccountMap.create({
    data: {
      accountId,
      alias: optionalString(formData, "alias"),
      environment: optionalString(formData, "environment"),
      serviceId: requireString(formData, "serviceId"),
    },
  });
  revalidateBack(formData, "/admin/customers");
  // 대시보드의 인라인 매핑 화면은 매핑 후 원래 자리로 돌아간다; 서비스 상세의
  // 매핑 폼은 redirectTo 없이 제자리에 머문다.
  const to = optionalString(formData, "redirectTo");
  if (to && to.startsWith("/")) redirect(to);
}

export async function deleteAccountMap(formData: FormData) {
  await prisma.awsAccountMap.delete({
    where: { id: requireString(formData, "id") },
  });
  revalidateBack(formData, "/admin/customers");
}

// --- Contacts ------------------------------------------------------------------

export async function createContact(formData: FormData) {
  await prisma.contact.create({
    data: {
      name: requireString(formData, "name"),
      email: optionalString(formData, "email"),
      phone: optionalString(formData, "phone"),
      slackId: optionalString(formData, "slackId"),
      department: optionalString(formData, "department"),
      customerId: optionalString(formData, "customerId"),
    },
  });
  revalidatePath("/admin/contacts");
}

/**
 * 멤버 수정 (M2). 소속 변경은 테넌트 격리를 깨뜨릴 수 있어 제한한다:
 * 배정이 남아 있는 인원은 내부로만 옮길 수 있다 (내부 인원은 모든 고객사
 * 드롭다운에 나타나므로 기존 배정이 계속 유효하다). 고객사→다른 고객사는
 * 배정을 먼저 해제해야 한다.
 */
export async function updateContact(formData: FormData) {
  const id = requireString(formData, "id");
  const nextCustomerId = optionalString(formData, "customerId");

  const current = await prisma.contact.findUnique({
    where: { id },
    include: { _count: { select: { assignments: true } } },
  });
  if (!current) throw new Error("이미 삭제된 인원입니다");
  if (
    (current.customerId ?? null) !== nextCustomerId &&
    nextCustomerId !== null &&
    current._count.assignments > 0
  ) {
    throw new Error(
      "배정이 남아 있는 인원의 소속은 다른 고객사로 바꿀 수 없습니다 — 먼저 배정을 해제하거나 내부 소속으로 변경하세요",
    );
  }

  await prisma.contact.update({
    where: { id },
    data: {
      name: requireString(formData, "name"),
      email: optionalString(formData, "email"),
      phone: optionalString(formData, "phone"),
      slackId: optionalString(formData, "slackId"),
      department: optionalString(formData, "department"),
      customerId: nextCustomerId,
    },
  });
  revalidatePath("/admin/contacts");
}

export async function deleteContact(formData: FormData) {
  await prisma.contact.delete({ where: { id: requireString(formData, "id") } });
  revalidatePath("/admin/contacts");
}

// --- Assignments (등록: 붙였다뗐다) -------------------------------------------
//
// A scope holds an ordered list with no role labels. Registering appends to the
// end; the 알람 처리 순서 screen is what moves people around. Both screens write
// the same rows — they just expose different decisions.

const SCOPE_FIELD: Record<ScopeLevel, "customerId" | "projectId" | "serviceId" | "accountId"> = {
  customer: "customerId",
  project: "projectId",
  service: "serviceId",
  account: "accountId",
};

function scopeField(level: ScopeLevel) {
  const field = SCOPE_FIELD[level];
  if (!field) throw new Error(`bad scope level: ${level}`);
  return field;
}

/** Rewrite a scope's rows to 0..n-1 so gaps never accumulate. */
async function renumber(
  field: "customerId" | "projectId" | "serviceId" | "accountId",
  scopeId: string,
) {
  const rows = await prisma.assignment.findMany({
    where: { [field]: scopeId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  await prisma.$transaction(
    rows.map((r: { id: string }, i: number) =>
      prisma.assignment.update({ where: { id: r.id }, data: { order: i } }),
    ),
  );
}

/**
 * Attach a contact to a scope at the end of its list. Re-adding someone who is
 * already on the scope is a no-op rather than a duplicate row — a person can
 * only hold one position in one list.
 */
export async function addAssignment(formData: FormData) {
  const level = requireString(formData, "level") as ScopeLevel;
  const scopeId = requireString(formData, "scopeId");
  // 항목은 사람 또는 팀 — 폼이 둘 중 하나를 보낸다.
  const teamId = optionalString(formData, "teamId");
  const contactId = teamId ? null : requireString(formData, "contactId");
  await appendToScope(level, scopeId, contactId ? { contactId } : { teamId: teamId! });
  revalidateBack(formData, "/admin/customers");
}

async function appendToScope(
  level: ScopeLevel,
  scopeId: string,
  item: { contactId: string } | { teamId: string },
) {
  const field = scopeField(level);

  const existing = await prisma.assignment.findFirst({
    where: { [field]: scopeId, ...item },
  });
  if (!existing) {
    const last = await prisma.assignment.findFirst({
      where: { [field]: scopeId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    try {
      await prisma.assignment.create({
        data: {
          ...item,
          [field]: scopeId,
          order: last ? last.order + 1 : 0,
        },
      });
    } catch (e) {
      // Unique(contact|team, scope) race — someone attached the same item
      // between our check and the insert. Already there, so nothing to do.
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
}

/**
 * "+ 새 인원 등록" 인라인 (§6.3/6.4): create the person AND put them at the
 * end of this scope's list in one submit, so registering a brand-new contact
 * doesn't require a round-trip through 멤버 관리.
 *
 * 소속 is an explicit choice (이 고객사 or 내부) because it decides tenant
 * isolation: a customer-affiliated contact only ever appears in that
 * customer's dropdowns.
 */
export async function createContactAndAssign(formData: FormData) {
  const level = requireString(formData, "level") as ScopeLevel;
  const scopeId = requireString(formData, "scopeId");
  scopeField(level); // validate early, before creating the contact

  const affiliation = requireString(formData, "affiliation");
  if (affiliation !== "customer" && affiliation !== "internal") {
    throw new Error(`bad affiliation: ${affiliation}`);
  }

  const contact = await prisma.contact.create({
    data: {
      name: requireString(formData, "name"),
      department: optionalString(formData, "department"),
      email: optionalString(formData, "email"),
      customerId:
        affiliation === "customer" ? requireString(formData, "customerId") : null,
    },
  });
  await appendToScope(level, scopeId, { contactId: contact.id });
  revalidateBack(formData, "/admin/customers");
  revalidatePath("/admin/contacts");
}

export async function removeAssignment(formData: FormData) {
  let row;
  try {
    row = await prisma.assignment.delete({
      where: { id: requireString(formData, "id") },
    });
  } catch (e) {
    // P2025: already gone (double submit or a concurrent remove) — the desired
    // end state is reached, so just refresh the page.
    if ((e as { code?: string }).code !== "P2025") throw e;
    revalidateBack(formData, "/admin/customers");
    return;
  }
  const field = row.customerId
    ? "customerId"
    : row.projectId
      ? "projectId"
      : row.serviceId
        ? "serviceId"
        : "accountId";
  const scopeId = row[field];
  if (scopeId) await renumber(field, scopeId);
  revalidateBack(formData, "/admin/customers");
}

/**
 * Move one person up or down within their scope's list by swapping with the
 * neighbour. Bounds are a no-op so a double-submit at the edge is harmless.
 */
export async function moveAssignment(formData: FormData) {
  const id = requireString(formData, "id");
  const direction = requireString(formData, "direction");
  if (direction !== "up" && direction !== "down") {
    throw new Error(`bad direction: ${direction}`);
  }

  const row = await prisma.assignment.findUnique({ where: { id } });
  if (!row) {
    // Removed concurrently — nothing to move.
    revalidateBack(formData, "/admin/escalation");
    return;
  }

  const field = row.customerId
    ? "customerId"
    : row.projectId
      ? "projectId"
      : row.serviceId
        ? "serviceId"
        : "accountId";
  const scopeId = row[field];
  if (!scopeId) throw new Error("assignment has no scope");

  const siblings = await prisma.assignment.findMany({
    where: { [field]: scopeId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const index = siblings.findIndex((s: { id: string }) => s.id === id);
  const target = direction === "up" ? index - 1 : index + 1;

  if (index >= 0 && target >= 0 && target < siblings.length) {
    const reordered = [...siblings];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    await prisma.$transaction(
      reordered.map((r, i) =>
        prisma.assignment.update({ where: { id: r.id }, data: { order: i } }),
      ),
    );
  }
  revalidateBack(formData, "/admin/escalation");
}


// --- Teams (에스컬레이션 그룹) --------------------------------------------------
//
// 팀은 재사용 가능한 순번 목록이다. 멤버 후보는 배정 드롭다운과 같은 규칙 —
// 내부 인원 + (고객사 팀이면) 그 고객사 인원. 순서 조작은 Assignment와 같은
// renumber/swap 패턴.

function revalidateTeams(formData: FormData) {
  revalidatePath("/admin/teams");
  revalidatePath("/admin/org");
  revalidateBack(formData, "/admin/teams");
}

export async function createTeam(formData: FormData) {
  const name = requireString(formData, "name");
  const customerId = optionalString(formData, "customerId");
  const team = await prisma.team.create({ data: { name, customerId } });
  revalidateTeams(formData);
  redirectWithId(formData, team.id);
}

export async function renameTeam(formData: FormData) {
  await prisma.team.update({
    where: { id: requireString(formData, "id") },
    data: { name: requireString(formData, "name") },
  });
  revalidateTeams(formData);
}

export async function deleteTeam(formData: FormData) {
  // 팀을 참조하던 스코프 배정 행은 cascade로 함께 사라진다 — 그 스코프는
  // 상위 상속으로 돌아간다. DangerDelete가 이를 경고한다.
  await prisma.team.delete({ where: { id: requireString(formData, "id") } });
  revalidateTeams(formData);
}

async function renumberTeam(teamId: string) {
  const rows = await prisma.teamMember.findMany({
    where: { teamId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  await prisma.$transaction(
    rows.map((r, i) => prisma.teamMember.update({ where: { id: r.id }, data: { order: i } })),
  );
}

export async function addTeamMember(formData: FormData) {
  const teamId = requireString(formData, "teamId");
  const contactId = requireString(formData, "contactId");

  // 테넌트 격리: 고객사 팀에는 그 고객사 인원 + 내부 인원만.
  const [team, contact] = await Promise.all([
    prisma.team.findUnique({ where: { id: teamId } }),
    prisma.contact.findUnique({ where: { id: contactId } }),
  ]);
  if (!team || !contact) throw new Error("팀 또는 인원이 없습니다");
  if (contact.customerId && contact.customerId !== team.customerId) {
    throw new Error("다른 고객사 소속 인원은 이 팀에 넣을 수 없습니다");
  }

  const last = await prisma.teamMember.findFirst({
    where: { teamId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  try {
    await prisma.teamMember.create({
      data: { teamId, contactId, order: last ? last.order + 1 : 0 },
    });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e;
  }
  revalidateTeams(formData);
}

export async function removeTeamMember(formData: FormData) {
  let row;
  try {
    row = await prisma.teamMember.delete({ where: { id: requireString(formData, "id") } });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2025") throw e;
    revalidateTeams(formData);
    return;
  }
  await renumberTeam(row.teamId);
  revalidateTeams(formData);
}

export async function moveTeamMember(formData: FormData) {
  const id = requireString(formData, "id");
  const direction = requireString(formData, "direction");
  if (direction !== "up" && direction !== "down") {
    throw new Error(`bad direction: ${direction}`);
  }
  const row = await prisma.teamMember.findUnique({ where: { id } });
  if (!row) {
    revalidateTeams(formData);
    return;
  }
  const siblings = await prisma.teamMember.findMany({
    where: { teamId: row.teamId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const index = siblings.findIndex((s) => s.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index >= 0 && target >= 0 && target < siblings.length) {
    const reordered = [...siblings];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    await prisma.$transaction(
      reordered.map((r, i) =>
        prisma.teamMember.update({ where: { id: r.id }, data: { order: i } }),
      ),
    );
  }
  revalidateTeams(formData);
}
