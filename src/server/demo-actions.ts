"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/server/auth";
import { runDemoCleanup } from "@/server/demo";

/** 시스템 진단 › 데모 데이터 정리. 확인 문구를 정확히 쳐야 지운다. */
export async function cleanupDemoData(formData: FormData) {
  await requireRole("ADMIN");
  if (String(formData.get("confirm") ?? "").trim() !== "정리") {
    redirect("/admin/auth?demo=confirm#demo");
  }
  const r = await runDemoCleanup();
  revalidatePath("/", "layout");
  redirect(`/admin/auth?demo=done&c=${r.customers}&a=${r.alerts}&p=${r.contacts}&t=${r.teams}#demo`);
}
