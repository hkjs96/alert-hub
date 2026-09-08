import { prisma } from "@/lib/prisma";
import {
  resolveTeamOrder,
  type OnCallSource,
  type OverrideLite,
  type ShiftLite,
  parseWeekdays,
} from "@/lib/oncall";

export interface TeamResolution {
  name: string;
  timezone: string;
  /** 지금 순서 (활성 멤버만). */
  order: string[];
  source: OnCallSource;
  /** contactId → 레이어 라벨 ("야간", "대체 근무"). 기본 순서면 없음. */
  labelOf: Map<string, string>;
}

/**
 * 여러 팀의 "지금 순서"를 쿼리 3개로 한 번에 읽는다: 팀+기본 멤버, 시프트+멤버,
 * 현재 유효한 대체 근무. 비활성 인원은 어느 레이어에서도 펼치지 않는다 —
 * 팀 소속은 남기되 통지에서 빠진다.
 */
export async function resolveTeamOrders(
  teamIds: string[],
  at: Date = new Date(),
): Promise<Map<string, TeamResolution>> {
  const ids = [...new Set(teamIds.filter(Boolean))];
  const map = new Map<string, TeamResolution>();
  if (!ids.length) return map;

  const [teams, shifts, overrides] = await Promise.all([
    prisma.team.findMany({
      where: { id: { in: ids } },
      include: {
        members: {
          where: { contact: { active: true } },
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          select: { contactId: true },
        },
      },
    }),
    prisma.onCallShift.findMany({
      where: { teamId: { in: ids }, enabled: true },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      include: {
        members: {
          where: { contact: { active: true } },
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          select: { contactId: true },
        },
      },
    }),
    prisma.onCallOverride.findMany({
      where: { teamId: { in: ids }, startAt: { lte: at }, endAt: { gt: at }, contact: { active: true } },
      orderBy: { startAt: "asc" },
    }),
  ]);

  for (const t of teams) {
    const teamShifts: ShiftLite[] = shifts
      .filter((s) => s.teamId === t.id)
      .map((s) => ({
        id: s.id,
        name: s.name,
        weekdays: parseWeekdays(s.weekdays),
        startMin: s.startMin,
        endMin: s.endMin,
        priority: s.priority,
        enabled: s.enabled,
        members: s.members.map((m) => m.contactId),
      }));
    const teamOverrides: OverrideLite[] = overrides
      .filter((o) => o.teamId === t.id)
      .map((o) => ({ id: o.id, contactId: o.contactId, startAt: o.startAt, endAt: o.endAt, note: o.note }));
    const r = resolveTeamOrder({
      defaultOrder: t.members.map((m) => m.contactId),
      shifts: teamShifts,
      overrides: teamOverrides,
      timezone: t.timezone,
      now: at,
    });
    map.set(t.id, { name: t.name, timezone: t.timezone, order: r.order, source: r.source, labelOf: r.labelOf });
  }
  return map;
}
