"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth";

function opt(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

/**
 * 내 프로필 — 폼에 실린 필드만 고친다(이름·부서·시간대·Slack ID·전화). 이메일과
 * 소속은 SSO가 결정하므로 받지 않는다. open 모드(SSO 미연결)에서는 세션이
 * 없어 고칠 대상이 없다 — 관리자 화면에서 대신 입력한다.
 */
export async function updateMyProfile(formData: FormData) {
  const me = await requireUser();
  const backRaw = formData.get("back");
  const back = typeof backRaw === "string" && backRaw.startsWith("/") ? backRaw : "/me";
  if (!me) redirect("/login?next=" + encodeURIComponent(back));
  const data: Record<string, string | null> = {};
  for (const k of ["department", "slackId", "phone", "timezone"] as const) {
    if (formData.has(k)) data[k] = opt(formData, k);
  }
  const name = opt(formData, "name");
  if (formData.has("name") && name) data.name = name;
  // Slack ID 가 바뀌면 확인 상태도 리셋 — 새 ID 로 다시 코드를 받아야 한다.
  const resetSlack = formData.has("slackId") && (data.slackId ?? null) !== (me.slackId ?? null);
  await prisma.contact.update({
    where: { id: me.id },
    data: { ...data, ...(resetSlack ? { slackVerifiedAt: null } : {}) },
  });
  revalidatePath("/me");
  revalidatePath("/welcome");
  revalidatePath("/", "layout");
  const u = new URL(back, "http://x");
  u.searchParams.set("saved", "1");
  redirect(u.pathname + u.search);
}
