import { prisma } from "@/lib/prisma";
import {
  inheritedOrderFor,
  resolveResponsibility,
  type AssignmentLite,
  type Responsibility,
  type ScopeLevel,
} from "@/lib/org/resolve";

// Read-side queries for the org master data: scope-chain resolution for
// alerts (2b uses this at ingest time) and roster rollups for the admin UI.

export interface ScopeChain {
  account: { id: string; accountId: string; alias: string | null; environment: string | null };
  service: { id: string; name: string };
  project: { id: string; name: string };
  customer: { id: string; name: string };
}

/** AWS account id (from an alarm ARN) → full containment chain, or null. */
export async function resolveChainByAwsAccount(
  awsAccountId: string,
): Promise<ScopeChain | null> {
  const account = await prisma.awsAccountMap.findUnique({
    where: { accountId: awsAccountId },
    include: {
      service: { include: { project: { include: { customer: true } } } },
    },
  });
  if (!account) return null;
  const service = account.service;
  const project = service.project;
  const customer = project.customer;
  return {
    account: {
      id: account.id,
      accountId: account.accountId,
      alias: account.alias,
      environment: account.environment,
    },
    service: { id: service.id, name: service.name },
    project: { id: project.id, name: project.name },
    customer: { id: customer.id, name: customer.name },
  };
}

/** Load every assignment attached anywhere on a chain and resolve ownership. */
export async function resolveOwnership(
  chain: ScopeChain,
): Promise<Responsibility> {
  const rows = await prisma.assignment.findMany({
    where: {
      OR: [
        { accountId: chain.account.id },
        { serviceId: chain.service.id },
        { projectId: chain.project.id },
        { customerId: chain.customer.id },
      ],
    },
  });
  const lite: AssignmentLite[] = rows.map((r: any) => ({
    contactId: r.contactId,
    order: r.order ?? 0,
    level: (r.accountId
      ? "account"
      : r.serviceId
        ? "service"
        : r.projectId
          ? "project"
          : "customer") as ScopeLevel,
  }));
  return resolveResponsibility(lite);
}

// --- Roster rollup ----------------------------------------------------------

export interface RosterEntry {
  assignmentId: string;
  contact: { id: string; name: string; department: string | null };
  /** Position within the scope the row is attached to. 0 = 1순위 there. */
  order: number;
  /** Where the row is attached: this scope ("direct") or a descendant label. */
  via: string;
  direct: boolean;
}

/**
 * Everyone involved with a scope: rows attached to the scope itself PLUS rows
 * attached to any descendant ("프로젝트 A의 사람들 = 홍길동(직접) + 김또깡(↳ A.b)").
 */
export async function getRoster(
  level: Extract<ScopeLevel, "customer" | "project" | "service">,
  id: string,
): Promise<RosterEntry[]> {
  const where =
    level === "customer"
      ? {
          OR: [
            { customerId: id },
            { project: { customerId: id } },
            { service: { project: { customerId: id } } },
            { account: { service: { project: { customerId: id } } } },
          ],
        }
      : level === "project"
        ? {
            OR: [
              { projectId: id },
              { service: { projectId: id } },
              { account: { service: { projectId: id } } },
            ],
          }
        : { OR: [{ serviceId: id }, { account: { serviceId: id } }] };

  const rows = await prisma.assignment.findMany({
    where,
    include: {
      contact: true,
      project: true,
      service: true,
      account: true,
    },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });

  return rows.map((r: any) => {
    const direct =
      (level === "customer" && r.customerId === id) ||
      (level === "project" && r.projectId === id) ||
      (level === "service" && r.serviceId === id);
    let via = "직접";
    if (!direct) {
      if (r.account) via = `↳ 계정 ${r.account.alias ?? r.account.accountId}`;
      else if (r.service) via = `↳ 서비스 ${r.service.name}`;
      else if (r.project) via = `↳ 프로젝트 ${r.project.name}`;
    }
    return {
      assignmentId: r.id,
      contact: {
        id: r.contact.id,
        name: r.contact.name,
        department: r.contact.department,
      },
      order: r.order ?? 0,
      via,
      direct,
    };
  });
}

/** Assignments attached directly to one scope (for the editor widget). */
export async function getDirectAssignments(level: ScopeLevel, id: string) {
  const where =
    level === "customer"
      ? { customerId: id }
      : level === "project"
        ? { projectId: id }
        : level === "service"
          ? { serviceId: id }
          : { accountId: id };
  return prisma.assignment.findMany({
    where,
    include: { contact: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Contact candidates for the assignment dropdown: internal (MSP) people plus
 * this customer's own people, nothing else.
 *
 * v0.2 also offered a "다른 고객사 인원" group; v0.3 removed it so a customer's
 * roster can't accidentally be filled with another tenant's staff.
 */
export async function getContactChoices(customerId: string) {
  const contacts = await prisma.contact.findMany({
    where: { OR: [{ customerId }, { customerId: null }] },
    orderBy: { name: "asc" },
    include: { customer: true },
  });
  return contacts;
}

/**
 * The order a scope would inherit from its ancestors, for the escalation
 * screen's "이 단계는 비어 있고 실제로는 이게 적용됩니다" hint. Returns an
 * empty resolution for 고객사 (nothing above it) or when no ancestor has rows.
 */
export async function getInheritedOrder(
  level: "customer" | "project" | "service",
  scope: { customerId: string; projectId?: string },
): Promise<Responsibility> {
  if (level === "customer") return inheritedOrderFor("customer", []);

  const rows = await prisma.assignment.findMany({
    where: {
      OR: [
        { customerId: scope.customerId },
        ...(scope.projectId ? [{ projectId: scope.projectId }] : []),
      ],
    },
  });

  const lite: AssignmentLite[] = rows.map((r: any) => ({
    contactId: r.contactId,
    order: r.order ?? 0,
    level: (r.projectId ? "project" : "customer") as ScopeLevel,
  }));
  return inheritedOrderFor(level, lite);
}

/** Contacts by id, for rendering a resolved order as names. */
export async function getContactsByIds(ids: string[]) {
  if (!ids.length) return [];
  const rows = await prisma.contact.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((c: any) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as typeof rows;
}
