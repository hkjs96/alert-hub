import { prisma } from "@/lib/prisma";
import { matchRoutingRule, type RoutingSubject } from "@/lib/routing";
import type { OwnershipInfo } from "@/server/org";

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

    const members = await prisma.teamMember.findMany({
      where: { teamId: hit.teamId, contact: { active: true } },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      include: { contact: true, team: { select: { name: true } } },
    });
    if (!members.length) {
      console.warn(`[routing] rule "${hit.name}" matched but team has no active members — keeping tree order`);
      return info;
    }
    const teamName = members[0].team.name;
    return {
      ...info,
      rule: { id: hit.id, name: hit.name, team: teamName },
      responsibility: {
        level: info.responsibility.level,
        order: members.map((m) => m.contactId),
        primaryId: members[0].contactId,
      },
      contacts: members.map((m) => ({
        id: m.contact.id,
        name: m.contact.name,
        department: m.contact.department,
        slackId: m.contact.slackId,
        email: m.contact.email,
        phone: m.contact.phone,
        team: teamName,
      })),
    };
  } catch (err) {
    console.error("[routing] rule lookup failed — keeping tree order", err);
    return info;
  }
}
