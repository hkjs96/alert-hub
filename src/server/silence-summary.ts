import { prisma } from "@/lib/prisma";
import { sendSlackText } from "@/lib/notify/slack";
import { refireNotifications } from "@/server/alerts";

// 점검 종료 요약 (v2 프레임 05 우측): 점검 창이 끝나면(만료·조기 해제)
// Slack에 창 동안의 요약을 한 번 보내고, 아직 FIRING인 알람의 통지를 즉시
// 재개한다. 틱(/api/cron/notify)이 부른다.
//
// 정확히 한 번: summaryAt을 낙관적으로 선점한다. 발송이 실패하면 null로
// 되돌려 다음 틱이 재시도한다. Slack 미설정이면 요약 없이 마감만 한다.

function fmt(d: Date): string {
  return d.toISOString().slice(5, 16).replace("T", " ") + "Z";
}

type ScopeWhere =
  | { path: ["chain", "serviceId"]; equals: string }
  | { path: ["chain", "projectId"]; equals: string }
  | { path: ["chain", "customerId"]; equals: string };

export async function summarizeEndedSilences(now = new Date()): Promise<number> {
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const ended = await prisma.silence.findMany({
    where: {
      summaryAt: null,
      OR: [
        { revokedAt: { not: null, gte: dayAgo } },
        { revokedAt: null, endsAt: { lte: now, gte: dayAgo } },
      ],
    },
    include: {
      customer: { select: { name: true } },
      project: { select: { name: true, customer: { select: { name: true } } } },
      service: {
        select: {
          name: true,
          project: {
            select: { name: true, customer: { select: { name: true } } },
          },
        },
      },
    },
    take: 20,
  });

  let sent = 0;
  for (const s of ended) {
    // 선점: 겹치는 틱과의 경합은 여기서 끝난다.
    const claimed = await prisma.silence.updateMany({
      where: { id: s.id, summaryAt: null },
      data: { summaryAt: now },
    });
    if (claimed.count === 0) continue;

    // 예약을 시작 전에 취소했으면 조용했던 기간 자체가 없다 — 요약 없이 마감.
    const windowEnd = s.revokedAt ?? s.endsAt;
    if (s.startsAt >= windowEnd) continue;

    // 알람 단위 뮤트는 요약 메시지 없이 마감 (요약은 점검 창의 것).
    const scopeWhere: ScopeWhere | null = s.serviceId
      ? { path: ["chain", "serviceId"], equals: s.serviceId }
      : s.projectId
        ? { path: ["chain", "projectId"], equals: s.projectId }
        : s.customerId
          ? { path: ["chain", "customerId"], equals: s.customerId }
          : null;
    if (!scopeWhere) continue;

    const scopeLabel = s.service
      ? `${s.service.project.customer.name} › ${s.service.project.name} › ${s.service.name}`
      : s.project
        ? `${s.project.customer.name} › ${s.project.name}`
        : (s.customer?.name ?? "");
    const scopeName = scopeLabel.split("›").pop()!.trim();

    try {
      // 창 동안 FIRING 이벤트가 있었던 스코프 알람들.
      const firedEvents = await prisma.alertEvent.findMany({
        where: {
          status: "FIRING",
          createdAt: { gte: s.startsAt, lte: windowEnd },
          alert: { ownershipSnapshot: scopeWhere },
        },
        select: { alertId: true },
      });
      const firedDuringIds = new Set(firedEvents.map((e) => e.alertId));
      const firedDuring = firedDuringIds.size;

      const remaining = await prisma.alert.findMany({
        where: { status: "FIRING", ownershipSnapshot: scopeWhere },
        orderBy: { lastSeenAt: "desc" },
      });
      const autoResolved = Math.max(firedDuring - remaining.length, 0);
      // 재개(즉시 발송) 대상은 "창 안에서 발화해 팬아웃을 건너뛴" 알람만 —
      // 창 이전이나 해제 이후에 이미 통지된 FIRING을 또 페이징하면 중복이다.
      const refireTargets = remaining.filter((a) => firedDuringIds.has(a.id));

      const lines: string[] = [
        `🔧 *점검 창 종료 — ${scopeName}*`,
        `${scopeLabel} · ${fmt(s.startsAt)} → ${fmt(windowEnd)}${
          s.revokedAt ? " (조기 해제)" : ""
        } · 사유: ${s.reason}`,
        `뮤트 중 발생 *${firedDuring}* · 남은 FIRING *${remaining.length}* · 자동 해소 *${autoResolved}*`,
      ];
      if (remaining.length > 0) {
        for (const a of remaining.slice(0, 5)) {
          lines.push(`• ${a.severity} ${a.title} (${a.count}회)`);
        }
        if (remaining.length > 5) lines.push(`… 외 ${remaining.length - 5}건`);
      }
      lines.push(
        refireTargets.length > 0
          ? `지금부터 통지가 재개됩니다 — 뮤트 중 발화한 ${refireTargets.length}건은 즉시 발송됩니다.`
          : "지금부터 통지가 재개됩니다.",
      );

      const result = await sendSlackText(lines.join("\n"));
      if (result === "sent") sent += 1;

      // 뮤트 때문에 팬아웃을 놓친 알람의 통지를 즉시(묶음 창 경유) 재개.
      for (const a of refireTargets) {
        await refireNotifications(a);
      }
    } catch (err) {
      console.error(`[silence-summary] ${s.id} failed — will retry`, err);
      await prisma.silence.updateMany({
        where: { id: s.id, summaryAt: now },
        data: { summaryAt: null },
      });
    }
  }
  return sent;
}
