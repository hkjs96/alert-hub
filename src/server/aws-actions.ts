"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/auth";
import { checkReaderRole, newExternalId } from "@/lib/aws/graph";

function backOf(formData: FormData): string {
  const b = String(formData.get("back") ?? "");
  return b.startsWith("/") ? b : "/admin/org";
}

/** 고객사 ExternalId 발급(없을 때만). 이미 있으면 그대로 — 바꾸면 고객사 역할도 고쳐야 하므로. */
export async function issueExternalId(formData: FormData) {
  await requireRole("ADMIN");
  const customerId = String(formData.get("customerId") ?? "");
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: customerId }, select: { awsExternalId: true } });
  if (!c.awsExternalId) await prisma.customer.update({ where: { id: customerId }, data: { awsExternalId: newExternalId() } });
  revalidatePath(backOf(formData));
}

/** 계정 매핑에 읽기 역할 ARN 저장(비우면 연결 해제). 다른 계정의 역할은 거부. */
export async function saveReaderRole(formData: FormData) {
  await requireRole("ADMIN");
  const id = String(formData.get("accountMapId") ?? "");
  const raw = String(formData.get("roleArn") ?? "").trim();
  const map = await prisma.awsAccountMap.findUniqueOrThrow({ where: { id }, select: { accountId: true } });
  const back = backOf(formData);
  if (!raw) {
    await prisma.awsAccountMap.update({ where: { id }, data: { readerRoleArn: null, readerError: null, readerCheckedAt: null } });
    revalidatePath(back);
    return;
  }
  const check = checkReaderRole(raw, map.accountId);
  if (!check.ok) redirect(`${back}${back.includes("?") ? "&" : "?"}awsErr=${encodeURIComponent(check.reason)}#aws-${id}`);
  await prisma.awsAccountMap.update({ where: { id }, data: { readerRoleArn: check.arn, readerError: null, readerCheckedAt: null } });
  revalidatePath(back);
}

/** 알람 상세의 "Slack 에 다시 올리기" — 다음 통지 틱에서 스레드에 그래프를 다시 첨부. */
export async function retryGraph(formData: FormData) {
  await requireRole("OPERATOR");
  const alertId = String(formData.get("alertId") ?? "");
  const { assertAlertInScope } = await import("@/server/scope");
  await assertAlertInScope(alertId);
  const { requeueGraph } = await import("@/server/graph");
  await requeueGraph(alertId);
  revalidatePath(`/alerts/${alertId}`);
}

/** 시스템 진단 › AWS 그래프 › 위치(본문 / 스레드). */
export async function setGraphPlacementAction(formData: FormData) {
  await requireRole("ADMIN");
  const v = String(formData.get("placement") ?? "") === "thread" ? "thread" : "inline";
  const { setGraphPlacement } = await import("@/server/graph");
  const { currentActorName } = await import("@/server/auth");
  await setGraphPlacement(v, await currentActorName());
  revalidatePath("/admin/auth");
}
