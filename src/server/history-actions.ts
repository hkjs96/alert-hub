"use server";

import { revalidatePath } from "next/cache";
import { currentActorName, requireRole } from "@/server/auth";
import { isResolutionKind } from "@/lib/history";
import { setResolutionKind } from "@/server/history";

/** 알람 상세의 "어떻게 해결했나요?" — 라디오 하나 + 메모(선택). */
export async function classifyResolution(formData: FormData) {
  await requireRole("OPERATOR");
  const id = String(formData.get("id") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim();
  const alertId = String(formData.get("alertId") ?? "").trim();
  const noteRaw = formData.get("note");
  const note = typeof noteRaw === "string" && noteRaw.trim() ? noteRaw.trim().slice(0, 200) : null;
  if (!id || !isResolutionKind(kind)) throw new Error("분류를 고르세요");
  await setResolutionKind({ id, kind, by: await currentActorName(), note });
  if (alertId) revalidatePath(`/alerts/${alertId}`);
}
