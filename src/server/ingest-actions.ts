"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/auth";
import { newIngestToken } from "@/lib/ingest-guard";

/** 고객사 전용 수신 주소 발급/재발급. 재발급하면 이전 주소는 즉시 무효 — SNS 구독을 새 주소로 바꿔야 한다. */
export async function issueIngestToken(formData: FormData) {
  await requireRole("ADMIN");
  const customerId = String(formData.get("customerId") ?? "");
  await prisma.customer.update({ where: { id: customerId }, data: { ingestToken: newIngestToken() } });
  revalidatePath(`/admin/customers/${customerId}`);
}

/** 전용 주소 끄기 — 이 고객사는 공용 주소로만 받는다. */
export async function revokeIngestToken(formData: FormData) {
  await requireRole("ADMIN");
  const customerId = String(formData.get("customerId") ?? "");
  await prisma.customer.update({ where: { id: customerId }, data: { ingestToken: null } });
  revalidatePath(`/admin/customers/${customerId}`);
}
