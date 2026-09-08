import { prisma } from "@/lib/prisma";
import { matchRoutingRule, type RoutingSubject } from "@/lib/routing";
import type { OwnershipInfo } from "@/server/org";
import { resolveTeamOrders } from "@/server/oncall";

/**
 * 라우팅 규칙 적용: 트리에서 해석된 담당(OwnershipInfo)을 알람 속성으로 덮어쓴다.
 * 규칙이 매치되면 그 팀의 활성 멤버(팀 순서)가 통째로 순서를 대체하고,
 * info.rule 에 어느 규칙이었는지 남는다(스냅샷·상세 표시용). 매치가 없거나
 * 팀이 비었거나 조회가 죽으면 트리 결과 그대로 — 규칙은 통지를 막는 쪽으로
 * 실패하면 안 된다.
 */
export async function applyRoutingRules(
  info: OwnershipInfo,
  subject: Omit<RoutingSubject, "serviceId">,
): Promise<OwnershipInfo> {
  try {
    const rules = await prisma.routingRule.findMany({
      where: { customerId: info.chain.customer.id, enabled: true },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    if (!rules.length) return info;
    const hit = matchRoutingRule(rules, { ...subject, serviceId: info.chain.service.id });
    if (!hit) return info;

    // 팀의 "지금 순서" — 시프트·대체 근무가 있으면 그 레이어가 앞에 온다.
    const res = (await resolveTeamOrders([hit.teamId])).get(hit.teamId);
    if (!res || !res.order.length) {
      console.warn(`[routing] rule "${hit.name}" matched but team has no active members — keeping tree order`);
      return info;
    }
    const contacts = await prisma.contact.findMany({ where: { id: { in: res.order } } });
    const byId = new Map(contacts.map((c) => [c.id, c]));
    const ordered = res.order.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
    if (!ordered.length) return info;
    const teamName = res.name;
    return {
      ...info,
      rule: { id: hit.id, name: hit.name, team: teamName },
      responsibility: {
        level: info.responsibility.level,
        order: ordered.map((c) => c.id),
        primaryId: ordered[0].id,
      },
      contacts: ordered.map((c) => ({
        id: c.id,
        name: c.name,
        department: c.department,
        slackId: c.slackId,
        email: c.email,
        phone: c.phone,
        team: teamName,
        shift: res.labelOf.get(c.id) ?? null,
      })),
    };
  } catch (err) {
    console.error("[routing] rule lookup failed — keeping tree order", err);
    return info;
  }
}
