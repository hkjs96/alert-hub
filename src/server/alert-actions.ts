"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentActorName } from "@/server/auth";

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
  // SSO 세션이 있으면 누가 했는지 남긴다. 없으면(SSO 꺼짐) null 그대로.
  const actor = await currentActorName();
  const moved = await prisma.alert.updateMany({
    where: { id, status: { in: from } },
    data: { status: to, ...(to === "ACKNOWLEDGED" && actor ? { ackedBy: actor } : {}) },
  });
  if (moved.count > 0) {
    await prisma.alertEvent.create({
      data: { alertId: id, status: to, stateReason: actor ? `${stateReason} · ${actor}` : stateReason },
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

/**
 * 일괄 Ack (v2 대시보드 헤더): 지금 화면에 보이는 FIRING들을 한 번에 잡는다.
 * ids는 대시보드가 렌더 시점에 hidden으로 넣은 것 — 제출 사이에 상태가 변한
 * 행은 가드(updateMany where FIRING)가 조용히 걸러낸다. per-id 가드 유지를
 * 위해 순차 처리 (한 화면 분량이라 n이 작다).
 */
export async function bulkAckAlerts(formData: FormData) {
  const ids = requireString(formData, "ids")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const back = formData.get("back");
  const actor = await currentActorName();
  for (const id of ids) {
    const moved = await prisma.alert.updateMany({
      where: { id, status: { in: ["FIRING"] } },
      data: { status: "ACKNOWLEDGED", ...(actor ? { ackedBy: actor } : {}) },
    });
    if (moved.count > 0) {
      await prisma.alertEvent.create({
        data: {
          alertId: id,
          status: "ACKNOWLEDGED",
          stateReason: actor ? `일괄 Ack (대시보드) · ${actor}` : "일괄 Ack (대시보드)",
        },
      });
    }
  }
  revalidatePath("/");
  if (typeof back === "string" && back.startsWith("/")) redirect(back);
}
