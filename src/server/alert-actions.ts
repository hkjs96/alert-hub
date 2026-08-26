"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

// 인시던트 액션 (Phase 2c) — 알람 상세의 Ack/Resolve 버튼 뒤.
//
// 전이는 명시적이고 이력은 append-only: 버튼이 만든 전이도 수신 이벤트와
// 똑같이 AlertEvent 행으로 남는다 (수정·삭제 없음).
//
// Each action is a guarded updateMany: the WHERE carries the only legal source
// states, so a double submit, a stale tab, or a race against an incoming OK is
// a silent no-op instead of a duplicate transition/event row.

function requireString(formData: FormData, key: string): string {
  const v = formData.get(key);
  if (typeof v !== "string" || !v.trim()) throw new Error(`missing ${key}`);
  return v.trim();
}

async function transition(
  id: string,
  from: string[],
  to: "ACKNOWLEDGED" | "RESOLVED",
  stateReason: string,
) {
  const moved = await prisma.alert.updateMany({
    where: { id, status: { in: from } },
    data: { status: to },
  });
  if (moved.count > 0) {
    await prisma.alertEvent.create({
      data: { alertId: id, status: to, stateReason },
    });
  }
  revalidatePath(`/alerts/${id}`);
  revalidatePath("/");
}

/**
 * FIRING → ACKNOWLEDGED: someone took the incident. Once acked, provider
 * resends of the same firing alarm no longer flip the status back (see
 * ingest) — only resolve/OK moves it on.
 */
export async function ackAlert(formData: FormData) {
  await transition(
    requireString(formData, "id"),
    ["FIRING"],
    "ACKNOWLEDGED",
    "수동 Ack (알람 상세)",
  );
}

/** FIRING/ACKNOWLEDGED → RESOLVED: closed by hand — OK 수신과 같은 종착지. */
export async function resolveAlert(formData: FormData) {
  await transition(
    requireString(formData, "id"),
    ["FIRING", "ACKNOWLEDGED"],
    "RESOLVED",
    "수동 Resolve (알람 상세)",
  );
}
