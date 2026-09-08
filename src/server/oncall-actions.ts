"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/auth";
import { fromZoned, parseHm, parseWeekdays, safeTimezone, TIMEZONE_CHOICES } from "@/lib/oncall";

// 시프트 · 대체 근무 편집. org-actions 와 같은 규약: <form> 이 back 을 들고
// 오고, 성공하면 그 경로를 revalidate 한다. 전부 ADMIN.

function backPath(formData: FormData): string {
  const raw = formData.get("back");
  return typeof raw === "string" && raw.startsWith("/") ? raw : "/admin/teams";
}
function revalidateBack(formData: FormData) {
  const back = backPath(formData);
  const q = back.indexOf("?");
  revalidatePath(q === -1 ? back : back.slice(0, q));
  revalidatePath("/admin/teams");
  revalidatePath("/admin/org");
}
function requireString(formData: FormData, key: string): string {
  const v = formData.get(key);
  if (typeof v !== "string" || !v.trim()) throw new Error(`missing ${key}`);
  return v.trim();
}
function optionalString(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** 팀 멤버 후보 규칙(내부 인원 + 그 고객사 인원)을 시프트·대체 근무에도 적용. */
async function assertContactFitsTeam(teamId: string, contactId: string) {
  const [team, contact] = await Promise.all([
    prisma.team.findUnique({ where: { id: teamId } }),
    prisma.contact.findUnique({ where: { id: contactId } }),
  ]);
  if (!team || !contact) throw new Error("팀 또는 인원이 없습니다");
  if (contact.customerId && contact.customerId !== team.customerId) {
    throw new Error("다른 고객사의 담당자는 이 팀에 넣을 수 없습니다");
  }
  return { team, contact };
}

export async function setTeamTimezone(formData: FormData) {
  await requireRole("ADMIN");
  const id = requireString(formData, "id");
  const tz = safeTimezone(requireString(formData, "timezone"));
  if (!(TIMEZONE_CHOICES as readonly string[]).includes(tz)) throw new Error("지원하지 않는 시간대");
  await prisma.team.update({ where: { id }, data: { timezone: tz } });
  revalidateBack(formData);
}

export async function createShift(formData: FormData) {
  await requireRole("ADMIN");
  const teamId = requireString(formData, "teamId");
  const name = requireString(formData, "name");
  const weekdays = parseWeekdays(formData.getAll("weekday").map(String).join(","));
  if (!weekdays.length) throw new Error("요일을 하나 이상 고르세요");
  const startMin = parseHm(requireString(formData, "start"));
  const endMin = parseHm(requireString(formData, "end"));
  if (startMin === null || endMin === null) throw new Error("시각 형식이 잘못됐습니다");
  if (startMin === endMin) throw new Error("시작과 끝이 같습니다 — 종일이면 00:00–24:00");
  const last = await prisma.onCallShift.findFirst({ where: { teamId }, orderBy: { priority: "desc" } });
  await prisma.onCallShift.create({
    data: {
      teamId,
      name,
      weekdays: weekdays.join(","),
      startMin,
      endMin: endMin === 0 ? 1440 : endMin,
      // 새 시프트가 기존 것 위에 얹힌다 (PagerDuty 의 아래 레이어 = 더 구체적).
      priority: last ? last.priority + 1 : 0,
    },
  });
  revalidateBack(formData);
}

export async function deleteShift(formData: FormData) {
  await requireRole("ADMIN");
  await prisma.onCallShift.delete({ where: { id: requireString(formData, "id") } });
  revalidateBack(formData);
}

export async function toggleShift(formData: FormData) {
  await requireRole("ADMIN");
  const id = requireString(formData, "id");
  const row = await prisma.onCallShift.findUnique({ where: { id } });
  if (!row) return;
  await prisma.onCallShift.update({ where: { id }, data: { enabled: !row.enabled } });
  revalidateBack(formData);
}

async function renumberShift(shiftId: string) {
  const rows = await prisma.onCallShiftMember.findMany({
    where: { shiftId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  await prisma.$transaction(
    rows.map((r, i) => prisma.onCallShiftMember.update({ where: { id: r.id }, data: { order: i } })),
  );
}

export async function addShiftMember(formData: FormData) {
  await requireRole("ADMIN");
  const shiftId = requireString(formData, "shiftId");
  const contactId = requireString(formData, "contactId");
  const shift = await prisma.onCallShift.findUnique({ where: { id: shiftId } });
  if (!shift) throw new Error("시프트가 없습니다");
  await assertContactFitsTeam(shift.teamId, contactId);
  const last = await prisma.onCallShiftMember.findFirst({ where: { shiftId }, orderBy: { order: "desc" } });
  try {
    await prisma.onCallShiftMember.create({
      data: { shiftId, contactId, order: last ? last.order + 1 : 0 },
    });
  } catch (err: any) {
    if (err?.code !== "P2002") throw err; // 이미 있음 — 조용히 무시
  }
  revalidateBack(formData);
}

export async function removeShiftMember(formData: FormData) {
  await requireRole("ADMIN");
  let row;
  try {
    row = await prisma.onCallShiftMember.delete({ where: { id: requireString(formData, "id") } });
  } catch (err: any) {
    if (err?.code === "P2025") return;
    throw err;
  }
  await renumberShift(row.shiftId);
  revalidateBack(formData);
}

export async function moveShiftMember(formData: FormData) {
  await requireRole("ADMIN");
  const id = requireString(formData, "id");
  const direction = requireString(formData, "direction");
  const row = await prisma.onCallShiftMember.findUnique({ where: { id } });
  if (!row) return;
  const siblings = await prisma.onCallShiftMember.findMany({
    where: { shiftId: row.shiftId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  const idx = siblings.findIndex((s) => s.id === id);
  const to = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || to < 0 || to >= siblings.length) return;
  const reordered = [...siblings];
  [reordered[idx], reordered[to]] = [reordered[to], reordered[idx]];
  await prisma.$transaction(
    reordered.map((r, i) => prisma.onCallShiftMember.update({ where: { id: r.id }, data: { order: i } })),
  );
  revalidateBack(formData);
}

export async function createOverride(formData: FormData) {
  await requireRole("ADMIN");
  const teamId = requireString(formData, "teamId");
  const contactId = requireString(formData, "contactId");
  const { team } = await assertContactFitsTeam(teamId, contactId);
  const startAt = fromZoned(requireString(formData, "start"), team.timezone);
  const endAt = fromZoned(requireString(formData, "end"), team.timezone);
  if (!startAt || !endAt) throw new Error("기간 형식이 잘못됐습니다");
  if (endAt <= startAt) throw new Error("끝이 시작보다 앞입니다");
  await prisma.onCallOverride.create({
    data: { teamId, contactId, startAt, endAt, note: optionalString(formData, "note") },
  });
  revalidateBack(formData);
}

export async function deleteOverride(formData: FormData) {
  await requireRole("ADMIN");
  try {
    await prisma.onCallOverride.delete({ where: { id: requireString(formData, "id") } });
  } catch (err: any) {
    if (err?.code !== "P2025") throw err;
  }
  revalidateBack(formData);
}
