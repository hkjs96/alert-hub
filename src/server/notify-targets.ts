import { prisma } from "@/lib/prisma";
import { resolveTargets, type NotifyTarget, type ScopeTargets } from "@/lib/notify/targets";

/**
 * 체인(고객사/프로젝트/서비스 id)에 붙은 통지 채널을 읽어 상속 규칙으로 고른다.
 * 실패하면 빈 배열 — 전사 기본으로 폴백해 통지가 막히지 않는다.
 */
export async function loadTargetsForChain(chain: {
  customerId?: string | null;
  projectId?: string | null;
  serviceId?: string | null;
}): Promise<NotifyTarget[]> {
  try {
    const rows = await prisma.notifyChannel.findMany({
      where: {
        enabled: true,
        OR: [
          ...(chain.serviceId ? [{ serviceId: chain.serviceId }] : []),
          ...(chain.projectId ? [{ projectId: chain.projectId }] : []),
          ...(chain.customerId ? [{ customerId: chain.customerId }] : []),
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    if (!rows.length) return [];
    const s: ScopeTargets = { service: [], project: [], customer: [] };
    for (const r of rows) {
      const t: NotifyTarget = { kind: r.kind, target: r.target, label: r.label };
      if (r.serviceId) s.service.push(t);
      else if (r.projectId) s.project.push(t);
      else if (r.customerId) s.customer.push(t);
    }
    return resolveTargets(s);
  } catch (err) {
    console.error("[notify] target lookup failed — falling back to default channel", err);
    return [];
  }
}

/** 화면용: 이 스코프의 직접 채널과, 비어 있을 때 실제로 적용될 상속 채널. */
export async function getScopeChannels(level: "customer" | "project" | "service", ids: {
  customerId: string;
  projectId?: string;
  serviceId?: string;
}) {
  const where =
    level === "service" ? { serviceId: ids.serviceId } : level === "project" ? { projectId: ids.projectId } : { customerId: ids.customerId };
  const direct = await prisma.notifyChannel.findMany({ where, orderBy: { createdAt: "asc" } });
  const inherited =
    direct.some((d) => d.enabled) || level === "customer"
      ? []
      : await loadTargetsForChain(
          level === "service"
            ? { customerId: ids.customerId, projectId: ids.projectId }
            : { customerId: ids.customerId },
        );
  return { direct, inherited };
}
