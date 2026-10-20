import { prisma } from "@/lib/prisma";

// 데모 데이터 정리 — scripts/reset-demo.mjs 와 같은 범위를 화면에서.
// 지우는 것: 시드 데모 고객사(네오위즈, 핀테크랩)와 하위 전부(cascade), 그 계정 ID와
// 미매핑 데모 계정(999999999999)으로 들어온 알람, 시드 내부 인원(@alert-hub.io),
// 그 결과 멤버가 없어진 내부 팀. 나머지는 손대지 않는다.

export const DEMO_CUSTOMERS = ["네오위즈", "핀테크랩"];
const DEMO_ACCOUNTS = ["999999999999"];
const DEMO_INTERNAL_EMAIL = "@alert-hub.io";

export interface DemoPlan {
  customers: { id: string; name: string }[];
  accountIds: string[];
  alerts: number;
  internal: { id: string; name: string; email: string | null }[];
  keepCustomers: number;
  /** 다음 배포 때 시드가 다시 채우는가 (SEED_DEMO=false 가 아니면 그렇다) */
  reseeds: boolean;
}

export async function planDemoCleanup(): Promise<DemoPlan> {
  const customers = await prisma.customer.findMany({
    where: { name: { in: DEMO_CUSTOMERS } },
    select: { id: true, name: true, projects: { select: { services: { select: { accounts: { select: { accountId: true } } } } } } },
  });
  const accountIds = [
    ...DEMO_ACCOUNTS,
    ...customers.flatMap((c) => c.projects.flatMap((p) => p.services.flatMap((s) => s.accounts.map((a) => a.accountId)))),
  ];
  const [alerts, internal, keepCustomers] = await Promise.all([
    prisma.alert.count({ where: { accountId: { in: accountIds } } }),
    prisma.contact.findMany({
      where: { customerId: null, email: { endsWith: DEMO_INTERNAL_EMAIL, mode: "insensitive" } },
      select: { id: true, name: true, email: true },
    }),
    prisma.customer.count({ where: { name: { notIn: DEMO_CUSTOMERS } } }),
  ]);
  return {
    customers: customers.map((c) => ({ id: c.id, name: c.name })),
    accountIds,
    alerts,
    internal,
    keepCustomers,
    reseeds: process.env.SEED_DEMO !== "false",
  };
}

export function isPlanEmpty(p: DemoPlan): boolean {
  return p.customers.length === 0 && p.alerts === 0 && p.internal.length === 0;
}

export interface DemoCleanupResult {
  customers: number;
  alerts: number;
  contacts: number;
  teams: number;
}

export async function runDemoCleanup(): Promise<DemoCleanupResult> {
  const plan = await planDemoCleanup();
  const [a, c, k] = await prisma.$transaction([
    prisma.alert.deleteMany({ where: { accountId: { in: plan.accountIds } } }),
    prisma.customer.deleteMany({ where: { id: { in: plan.customers.map((x) => x.id) } } }),
    prisma.contact.deleteMany({ where: { id: { in: plan.internal.map((x) => x.id) } } }),
  ]);
  // 데모 인원만 있던 내부 팀은 이름만 남는다 — 껍데기는 지운다.
  const t = await prisma.team.deleteMany({ where: { customerId: null, members: { none: {} } } });
  return { customers: c.count, alerts: a.count, contacts: k.count, teams: t.count };
}
