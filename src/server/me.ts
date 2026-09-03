import { prisma } from "@/lib/prisma";

/** 내 담당 범위 — 직접 배정과 팀 경유 배정을 사람이 읽는 라벨로. */
export interface MyScope {
  assignments: { id: string; label: string; via: string | null }[];
  teams: { id: string; name: string; customer: string | null }[];
  customerNames: string[];
  assignmentCount: number;
}

const chainInclude = {
  customer: { select: { name: true } },
  project: { select: { name: true, customer: { select: { name: true } } } },
  service: { select: { name: true, project: { select: { name: true, customer: { select: { name: true } } } } } },
  account: {
    select: {
      accountId: true,
      alias: true,
      service: { select: { name: true, project: { select: { name: true, customer: { select: { name: true } } } } } },
    },
  },
} as const;

type Row = {
  customer: { name: string } | null;
  project: { name: string; customer: { name: string } } | null;
  service: { name: string; project: { name: string; customer: { name: string } } } | null;
  account: {
    accountId: string;
    alias: string | null;
    service: { name: string; project: { name: string; customer: { name: string } } };
  } | null;
};

function labelOf(a: Row): { label: string; customer: string } {
  if (a.customer) return { label: `${a.customer.name} (고객사 전체)`, customer: a.customer.name };
  if (a.project) return { label: `${a.project.customer.name} › ${a.project.name}`, customer: a.project.customer.name };
  if (a.service)
    return {
      label: `${a.service.project.customer.name} › ${a.service.project.name} › ${a.service.name}`,
      customer: a.service.project.customer.name,
    };
  if (a.account)
    return {
      label: `${a.account.service.project.customer.name} › ${a.account.service.project.name} › ${a.account.service.name} · ${a.account.alias ?? a.account.accountId}`,
      customer: a.account.service.project.customer.name,
    };
  return { label: "?", customer: "?" };
}

export async function getMyScope(contactId: string): Promise<MyScope> {
  const [direct, memberships] = await Promise.all([
    prisma.assignment.findMany({ where: { contactId }, include: chainInclude }),
    prisma.teamMember.findMany({
      where: { contactId },
      include: {
        team: {
          include: { customer: { select: { name: true } }, assignments: { include: chainInclude } },
        },
      },
    }),
  ]);
  const customers = new Set<string>();
  const assignments: MyScope["assignments"] = [];
  for (const a of direct) {
    const { label, customer } = labelOf(a as Row);
    customers.add(customer);
    assignments.push({ id: a.id, label, via: null });
  }
  for (const m of memberships) {
    for (const a of m.team.assignments) {
      const { label, customer } = labelOf(a as Row);
      customers.add(customer);
      assignments.push({ id: a.id, label, via: m.team.name });
    }
  }
  return {
    assignments,
    teams: memberships.map((m) => ({ id: m.team.id, name: m.team.name, customer: m.team.customer?.name ?? null })),
    customerNames: [...customers].sort(),
    assignmentCount: assignments.length,
  };
}
