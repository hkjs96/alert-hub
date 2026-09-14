"use server";

import { revalidatePath } from "next/cache";
import { currentActorName, requireRole } from "@/server/auth";
import { assertAlertInScope } from "@/server/scope";
import { generateInsightNow, rateInsight, setInsightPolicy } from "@/server/insight";
import { prisma } from "@/lib/prisma";

/** 알람 상세의 "지금 생성 / 다시 시도". 조회 전용·고객사 계정은 못 누른다. */
export async function requestInsight(formData: FormData) {
  await requireRole("OPERATOR");
  const alertId = String(formData.get("alertId") ?? "").trim();
  if (!alertId) throw new Error("알람 id 가 없습니다");
  await assertAlertInScope(alertId);
  await generateInsightNow(alertId);
  revalidatePath(`/alerts/${alertId}`);
}

/** 👍 / 👎 — 보조 채점. 주 채점은 실제 분류와의 일치. */
export async function rateInsightAction(formData: FormData) {
  await requireRole("OPERATOR");
  const id = String(formData.get("id") ?? "").trim();
  const alertId = String(formData.get("alertId") ?? "").trim();
  const feedback = String(formData.get("feedback") ?? "");
  if (!id || (feedback !== "up" && feedback !== "down")) throw new Error("잘못된 요청");
  await assertAlertInScope(alertId);
  await rateInsight(id, feedback, await currentActorName());
  revalidatePath(`/alerts/${alertId}`);
}

/** 시스템 진단 › AI 메모 스위치. */
export async function setInsightPolicyAction(formData: FormData) {
  await requireRole("ADMIN");
  const on = String(formData.get("insights") ?? "") === "on";
  await setInsightPolicy(on, await currentActorName());
  revalidatePath("/admin/auth");
}

/** 고객사별 AI 메모 허용 — 고객사가 외부 전송을 거부하면 끈다. */
export async function setCustomerAiInsights(formData: FormData) {
  await requireRole("ADMIN");
  const id = String(formData.get("customerId") ?? "").trim();
  if (!id) throw new Error("고객사 id 가 없습니다");
  const on = formData.get("aiInsights") === "on";
  await prisma.customer.update({ where: { id }, data: { aiInsights: on } });
  revalidatePath(`/admin/customers/${id}`);
}
