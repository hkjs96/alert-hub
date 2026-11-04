import { prisma } from "@/lib/prisma";
import { checkAlert, checkSubscription, topicAccountOf, type GuardDecision } from "@/lib/ingest-guard";
import type { NormalizedAlert } from "@/lib/types";

// 수집 보안 — 웹훅 라우트가 부른다. 규칙은 src/lib/ingest-guard.ts.

/** 고객사 전용 수집 토큰 → 고객사 id. 없거나 틀리면 null. */
export async function customerByIngestToken(token: string | null | undefined): Promise<string | null> {
  const t = token?.trim();
  if (!t || !t.startsWith("in_")) return null;
  const c = await prisma.customer.findUnique({ where: { ingestToken: t }, select: { id: true } });
  return c?.id ?? null;
}

/** AWS 계정 → 매핑된 고객사. */
async function customersOf(accounts: string[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(accounts.filter(Boolean)));
  if (!uniq.length) return new Map();
  const rows = await prisma.awsAccountMap.findMany({
    where: { accountId: { in: uniq } },
    select: { accountId: true, service: { select: { project: { select: { customerId: true } } } } },
  });
  return new Map(rows.map((r) => [r.accountId, r.service.project.customerId]));
}

async function reject(input: { kind: "alert" | "subscription"; reason: string; accountId?: string | null; topicArn?: string | null; title?: string | null; customerId?: string | null }) {
  console.warn(`[ingest-guard] rejected ${input.kind}: ${input.reason}`);
  try {
    await prisma.ingestRejection.create({
      data: {
        kind: input.kind,
        reason: input.reason,
        accountId: input.accountId ?? null,
        topicArn: input.topicArn ?? null,
        title: input.title?.slice(0, 200) ?? null,
        customerId: input.customerId ?? null,
      },
    });
  } catch (err) {
    console.error("[ingest-guard] failed to record rejection", err);
  }
}

/** 구독 확인 전에. 거부면 이유를 기록하고 false. */
export async function guardSubscription(topicArn: string | null, tokenCustomer: string | null): Promise<GuardDecision> {
  const topicAccount = topicAccountOf(topicArn);
  const map = await customersOf(topicAccount ? [topicAccount] : []);
  const d = checkSubscription({ topicAccount, topicCustomer: topicAccount ? map.get(topicAccount) ?? null : null, tokenCustomer });
  if (!d.ok) await reject({ kind: "subscription", reason: d.reason, accountId: topicAccount, topicArn, customerId: tokenCustomer });
  return d;
}

/** 정규화된 알람 중 규칙을 통과한 것만 돌려준다. 거부분은 기록. */
export async function guardAlerts(
  alerts: NormalizedAlert[],
  ctx: { fromSns: boolean; topicArn: string | null; tokenCustomer: string | null },
): Promise<{ accepted: NormalizedAlert[]; rejected: number }> {
  const topicAccount = ctx.fromSns ? topicAccountOf(ctx.topicArn) : null;
  const map = await customersOf([...alerts.map((a) => a.accountId ?? ""), topicAccount ?? ""]);
  const accepted: NormalizedAlert[] = [];
  let rejected = 0;
  for (const a of alerts) {
    const d = checkAlert({
      alertAccount: a.accountId ?? null,
      alertCustomer: a.accountId ? map.get(a.accountId) ?? null : null,
      fromSns: ctx.fromSns,
      topicAccount,
      topicCustomer: topicAccount ? map.get(topicAccount) ?? null : null,
      tokenCustomer: ctx.tokenCustomer,
    });
    if (d.ok) accepted.push(a);
    else {
      rejected++;
      await reject({ kind: "alert", reason: d.reason, accountId: a.accountId, topicArn: ctx.topicArn, title: a.title, customerId: ctx.tokenCustomer });
    }
  }
  return { accepted, rejected };
}
