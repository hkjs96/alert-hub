import { prisma } from "@/lib/prisma";
import { buildAlertLinks, pickRunbook, type AlertLink, type RunbookRef } from "@/lib/links";

/** 규칙(있으면) → 서비스 순으로 런북을 찾는다. 조회 실패는 null (통지를 막지 않는다). */
export async function resolveRunbook(input: { ruleId?: string | null; serviceId?: string | null }): Promise<RunbookRef | null> {
  try {
    const [rule, service] = await Promise.all([
      input.ruleId
        ? prisma.routingRule.findUnique({ where: { id: input.ruleId }, select: { name: true, runbookUrl: true, runbook: true } })
        : null,
      input.serviceId
        ? prisma.service.findUnique({ where: { id: input.serviceId }, select: { name: true, runbookUrl: true, runbook: true } })
        : null,
    ]);
    return pickRunbook(rule, service);
  } catch (err) {
    console.error("[runbook] lookup failed", err);
    return null;
  }
}

/** 알람 하나의 링크 목록 (런북 + CloudWatch 콘솔). */
export async function linksForAlert(input: {
  fingerprint: string;
  ruleId?: string | null;
  serviceId?: string | null;
}): Promise<{ links: AlertLink[]; runbook: RunbookRef | null }> {
  const runbook = await resolveRunbook(input);
  return { links: buildAlertLinks({ fingerprint: input.fingerprint, runbook }), runbook };
}
