"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/server/auth";

function opt(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

/** 내 통지 프로필 — 세션의 사람만 자기 행을 고친다. 이메일·소속은 SSO가 결정. */
export async function updateMyProfile(formData: FormData) {
  const me = await getCurrentUser();
  if (!me) redirect("/login?next=/me");
  const name = (formData.get("name") as string | null)?.trim();
  await prisma.contact.update({
    where: { id: me.id },
    data: {
      ...(name ? { name } : {}),
      department: opt(formData, "department"),
      slackId: opt(formData, "slackId"),
      phone: opt(formData, "phone"),
    },
  });
  revalidatePath("/me");
  revalidatePath("/", "layout");
  redirect("/me?saved=1");
}
