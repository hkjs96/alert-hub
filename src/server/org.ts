import { prisma } from "@/lib/prisma";
import {
  expandAssignments,
  inheritedOrderFor,
  resolveResponsibility,
  type AssignmentLite,
  type AssignmentRowLite,
  type Responsibility,
  type ScopeLevel,
} from "@/lib/org/resolve";

/** 팀 id들의 멤버 순서(contactId[])를 한 번에 읽는다. */
async function loadTeamMembers(teamIds: string[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(teamIds.filter(Boolean))];
  const map = new Map<string, string[]>();
  if (!ids.length) return map;
  const members = await prisma.teamMember.findMany({
    where: { teamId: { in: ids } },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { teamId: true, contactId: true },
  });
  for (const m of members) {
    const list = map.get(m.teamId) ?? [];
    list.push(m.contactId);
    map.set(m.teamId, list);
  }
  return map;
}

function levelOf(r: {
  accountId: string | null;
  serviceId: string | null;
  projectId: string | null;
}): ScopeLevel {
  return r.accountId ? "account" : r.serviceId ? "service" : r.projectId ? "project" : "customer";
}

/** DB 행 → 팀을 펼친 AssignmentLite 목록. */
async function toLite(
  rows: {
    contactId: string | null;
    teamId: string | null;
    order: number;
    accountId: string | null;
    serviceId: string | null;
    projectId: string | null;
  }[],
): Promise<AssignmentLite[]> {
  const teams = await loadTeamMembers(rows.map((r) => r.teamId ?? "").filter(Boolean));
  const lite: AssignmentRowLite[] = rows.map((r) => ({
    contactId: r.contactId,
    teamId: r.teamId,
    order: r.order ?? 0,
    level: levelOf(r),
  }));
  return expandAssignments(lite, teams);
}

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
  return resolveResponsibility(await toLite(rows));
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
      team: { include: { _count: { select: { members: true } } } },
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
      contact: r.contact
        ? { id: r.contact.id, name: r.contact.name, department: r.contact.department }
        : {
            id: r.team.id,
            name: `팀 · ${r.team.name}`,
            department: `${r.team._count.members}명`,
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
    include: {
      contact: true,
      team: {
        include: {
          members: {
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
            include: { contact: true },
          },
        },
      },
    },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * 스코프에 붙일 수 있는 팀: MSP 내부 공용 팀 + 이 고객사 전용 팀. 고객사
 * 인원과 같은 테넌트 격리 규칙.
 */
export async function getTeamChoices(customerId: string) {
  return prisma.team.findMany({
    where: { OR: [{ customerId }, { customerId: null }] },
    orderBy: { name: "asc" },
    include: { _count: { select: { members: true } }, customer: true },
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

  return inheritedOrderFor(level, await toLite(rows));
}

/** Contacts by id, for rendering a resolved order as names. */
export async function getContactsByIds(ids: string[]) {
  if (!ids.length) return [];
  const rows = await prisma.contact.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((c: any) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as typeof rows;
}

// --- Alert-side ownership lookup --------------------------------------------

export interface OwnershipContact {
  id: string;
  name: string;
  department: string | null;
  slackId: string | null;
  email: string | null;
  phone: string | null;
  /** 팀 항목을 통해 들어온 사람이면 그 팀 이름. 직접 등록이면 null. */
  team?: string | null;
}

export interface OwnershipInfo {
  chain: ScopeChain;
  responsibility: Responsibility;
  /** responsibility.order resolved to people, same order — [0] is 1순위. */
  contacts: OwnershipContact[];
}

/**
 * Resolve ownership for many AWS account ids in three queries total (accounts
 * with their chains, every assignment on any of those chains, the contacts) —
 * the dashboard calls this once per page load, so per-alert lookups would be
 * an N+1 on the hottest screen.
 *
 * An id missing from the returned map means the account is unmapped; the
 * caller distinguishes that from an alert with no account id at all.
 */
export async function getOwnershipByAccountIds(
  awsAccountIds: string[],
): Promise<Map<string, OwnershipInfo>> {
  const ids = [...new Set(awsAccountIds)].filter(Boolean);
  if (!ids.length) return new Map();

  const accounts = await prisma.awsAccountMap.findMany({
    where: { accountId: { in: ids } },
    include: {
      service: { include: { project: { include: { customer: true } } } },
    },
  });
  if (!accounts.length) return new Map();

  const rows = await prisma.assignment.findMany({
    where: {
      OR: [
        { accountId: { in: accounts.map((a: any) => a.id) } },
        { serviceId: { in: [...new Set(accounts.map((a: any) => a.serviceId))] } },
        { projectId: { in: [...new Set(accounts.map((a: any) => a.service.projectId))] } },
        {
          customerId: {
            in: [...new Set(accounts.map((a: any) => a.service.project.customerId))],
          },
        },
      ],
    },
  });

  // 팀 항목은 멤버로 펼친다 — 스냅샷에 "어느 팀을 통해"가 남도록 출처 팀
  // 이름도 함께 기억한다.
  const teamIds = [...new Set(rows.map((r: any) => r.teamId).filter(Boolean))] as string[];
  const teamMembers = await loadTeamMembers(teamIds);
  const teamNames = new Map<string, string>(
    teamIds.length
      ? (await prisma.team.findMany({ where: { id: { in: teamIds } } })).map((t) => [
          t.id,
          t.name,
        ])
      : [],
  );

  const contactIds = [
    ...new Set([
      ...rows.map((r: any) => r.contactId).filter(Boolean),
      ...[...teamMembers.values()].flat(),
    ]),
  ] as string[];
  const contacts = contactIds.length
    ? await prisma.contact.findMany({ where: { id: { in: contactIds } } })
    : [];
  const contactById = new Map(contacts.map((c: any) => [c.id, c]));

  const map = new Map<string, OwnershipInfo>();
  for (const account of accounts) {
    const service = account.service;
    const project = service.project;
    const customer = project.customer;

    // Only rows sitting on THIS chain — equality against the chain's own ids
    // keeps another tenant's service/project rows out.
    const chainRows = rows.filter(
      (r: any) =>
        r.accountId === account.id ||
        r.serviceId === service.id ||
        r.projectId === project.id ||
        r.customerId === customer.id,
    );
    const lite = expandAssignments(
      chainRows.map((r: any) => ({
        contactId: r.contactId,
        teamId: r.teamId,
        order: r.order ?? 0,
        level: levelOf(r),
      })),
      teamMembers,
    );
    const responsibility = resolveResponsibility(lite);

    // contactId → 그 사람이 어느 팀을 통해 들어왔는지 (직접이면 없음). 채택된
    // 레벨의 행만 본다 — 다른 레벨의 직접 등록은 이 알람에 쓰이지 않는다.
    const adopted = chainRows.filter((r: any) => levelOf(r) === responsibility.level);
    const viaTeam = new Map<string, string>();
    for (const r of adopted) {
      if (r.teamId) {
        for (const cid of teamMembers.get(r.teamId) ?? []) {
          if (!viaTeam.has(cid)) viaTeam.set(cid, teamNames.get(r.teamId) ?? "팀");
        }
      }
    }
    for (const r of adopted) if (r.contactId) viaTeam.delete(r.contactId);
    map.set(account.accountId, {
      chain: {
        account: {
          id: account.id,
          accountId: account.accountId,
          alias: account.alias,
          environment: account.environment,
        },
        service: { id: service.id, name: service.name },
        project: { id: project.id, name: project.name },
        customer: { id: customer.id, name: customer.name },
      },
      responsibility,
      contacts: responsibility.order
        .map((id) => contactById.get(id))
        .filter(Boolean)
        .map((c: any) => ({
          id: c.id,
          name: c.name,
          department: c.department,
          slackId: c.slackId,
          email: c.email,
          phone: c.phone,
          team: viaTeam.get(c.id) ?? null,
        })),
    });
  }
  return map;
}

/** Single-account form of getOwnershipByAccountIds. null = unmapped. */
export async function getOwnershipByAwsAccount(
  awsAccountId: string,
): Promise<OwnershipInfo | null> {
  const map = await getOwnershipByAccountIds([awsAccountId]);
  return map.get(awsAccountId) ?? null;
}

// --- 수신 시점 스냅샷 (BR-05) ------------------------------------------------

/**
 * What gets frozen onto an Alert when it is received / re-fires. Ids keep the
 * links clickable while they exist; names are denormalized so the record still
 * reads correctly after renames or deletions. Stored as JSON — audit shape,
 * never queried relationally.
 */
export interface OwnershipSnapshot {
  capturedAt: string;
  level: ScopeLevel | null;
  chain: {
    customerId: string;
    customerName: string;
    projectId: string;
    projectName: string;
    serviceId: string;
    serviceName: string;
    accountMapId: string;
    accountAlias: string | null;
    environment: string | null;
  };
  order: {
    contactId: string;
    name: string;
    department: string | null;
    /** 팀을 통해 배정된 경우 팀 이름 (표시용). */
    team?: string | null;
  }[];
}

export function buildOwnershipSnapshot(info: OwnershipInfo): OwnershipSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    level: info.responsibility.level,
    chain: {
      customerId: info.chain.customer.id,
      customerName: info.chain.customer.name,
      projectId: info.chain.project.id,
      projectName: info.chain.project.name,
      serviceId: info.chain.service.id,
      serviceName: info.chain.service.name,
      accountMapId: info.chain.account.id,
      accountAlias: info.chain.account.alias,
      environment: info.chain.account.environment,
    },
    order: info.contacts.map((c) => ({
      contactId: c.id,
      name: c.name,
      department: c.department,
      team: c.team ?? null,
    })),
  };
}

/**
 * Defensive read of the stored JSON — old rows predate the column and a
 * malformed value must degrade to "no snapshot", never crash a page.
 */
export function parseOwnershipSnapshot(raw: unknown): OwnershipSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  const chain = s.chain as Record<string, unknown> | undefined;
  if (
    typeof chain !== "object" ||
    chain === null ||
    typeof chain.customerName !== "string" ||
    typeof chain.serviceName !== "string" ||
    !Array.isArray(s.order)
  ) {
    return null;
  }
  return s as unknown as OwnershipSnapshot;
}
