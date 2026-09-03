"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isRole, ROLE_LABELS } from "@/lib/auth/roles";
import { sendSlackText } from "@/lib/notify/slack";
import { sendEmailText } from "@/lib/notify/email";
import { requireRole, requireSessionUser, requireUser } from "@/server/auth";

function str(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}
function backOf(fd: FormData, fallback: string): string {
  const b = fd.get("back");
  return typeof b === "string" && b.startsWith("/") && !b.startsWith("//") ? b : fallback;
}
function withParam(path: string, k: string, v: string): string {
  const u = new URL(path, "http://x");
  u.searchParams.set(k, v);
  return u.pathname + u.search;
}

const PING_COOLDOWN_MS = 60 * 60 * 1000;

// --- 가입 승인 (ADMIN) --------------------------------------------------------

export async function approveAccount(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const id = str(formData, "id");
  const role = str(formData, "role");
  if (!id || !isRole(role)) throw new Error("잘못된 요청");
  await prisma.contact.update({
    where: { id },
    data: { status: "ACTIVE", role, approvedAt: new Date(), approvedBy: admin?.name ?? "open" },
  });
  revalidatePath("/admin/teams");
  revalidatePath("/admin/auth");
}

export async function rejectAccount(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const id = str(formData, "id");
  if (!id) throw new Error("잘못된 요청");
  await prisma.contact.update({
    where: { id },
    data: { status: "REJECTED", approvedAt: new Date(), approvedBy: admin?.name ?? "open" },
  });
  revalidatePath("/admin/teams");
  revalidatePath("/admin/auth");
}

/** 관리자가 마지막 남은 ADMIN 을 강등·비활성하는 것을 막는다. */
export async function assertNotLastAdmin(contactId: string, nextRole: string | null, nextActive: boolean) {
  const cur = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!cur || cur.role !== "ADMIN" || cur.status !== "ACTIVE" || !cur.active) return;
  const losing = (nextRole && nextRole !== "ADMIN") || !nextActive;
  if (!losing) return;
  const others = await prisma.contact.count({
    where: { id: { not: contactId }, customerId: null, role: "ADMIN", status: "ACTIVE", active: true },
  });
  if (others === 0) throw new Error("마지막 관리자는 강등하거나 비활성할 수 없습니다");
}

// --- 승인 대기 · 권한 요청 알림 -------------------------------------------

async function pingAdmins(text: string): Promise<"sent" | "nochannel"> {
  const r = await sendSlackText(text).catch(() => "skipped" as const);
  return r === "sent" ? "sent" : "nochannel";
}

export async function requestApprovalPing() {
  const me = await requireSessionUser();
  if (!me) redirect("/");
  const now = Date.now();
  if (me.approvalPingAt && now - me.approvalPingAt.getTime() < PING_COOLDOWN_MS) {
    redirect("/pending?pinged=cooldown");
  }
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "") ?? "";
  const r = await pingAdmins(
    `:bust_in_silhouette: 가입 승인 대기 — ${me.name} <${me.email}> · 요청 권한 ${ROLE_LABELS[me.role]}${appUrl ? ` · ${appUrl}/admin/teams` : ""}`,
  );
  if (r === "sent") await prisma.contact.update({ where: { id: me.id }, data: { approvalPingAt: new Date() } });
  redirect(`/pending?pinged=${r}`);
}

export async function requestRoleUpgrade(formData: FormData) {
  const me = await requireUser();
  const role = str(formData, "role") ?? "ADMIN";
  const screen = str(formData, "screen") ?? "등록 관리";
  const back = `/denied?screen=${encodeURIComponent(screen)}`;
  if (!me) redirect("/");
  const now = Date.now();
  if (me.approvalPingAt && now - me.approvalPingAt.getTime() < PING_COOLDOWN_MS) {
    redirect(withParam(back, "rq", "cooldown"));
  }
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "") ?? "";
  const r = await pingAdmins(
    `:key: 권한 요청 — ${me.name} <${me.email}> · 현재 ${ROLE_LABELS[me.role]} → 요청 ${isRole(role) ? ROLE_LABELS[role] : role} (${screen})${appUrl ? ` · ${appUrl}/admin/teams` : ""}`,
  );
  if (r === "sent") await prisma.contact.update({ where: { id: me.id }, data: { approvalPingAt: new Date() } });
  redirect(withParam(back, "rq", r));
}

// --- 첫 로그인 · 프로필 -------------------------------------------------------

export async function completeOnboarding(formData: FormData) {
  const me = await requireUser();
  if (me) await prisma.contact.update({ where: { id: me.id }, data: { onboardedAt: new Date() } });
  revalidatePath("/", "layout");
  redirect(backOf(formData, "/"));
}

/** 통지 채널 테스트 발송 — Slack DM 멘션 또는 이메일. */
export async function sendTestNotification(formData: FormData) {
  const me = await requireUser();
  const channel = str(formData, "channel");
  const back = backOf(formData, "/me");
  if (!me) redirect(back);
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "") ?? "";
  let result: "sent" | "skipped" | "missing" = "missing";
  if (channel === "slack" && me.slackId) {
    result = await sendSlackText(
      `<@${me.slackId}> alert-hub 테스트 통지 — Slack 채널이 연결되었습니다.${appUrl ? ` ${appUrl}/me` : ""}`,
    ).catch(() => "skipped" as const);
  } else if (channel === "email" && me.email) {
    result = await sendEmailText(
      me.email,
      "[alert-hub] 테스트 통지",
      `이메일 채널이 연결되었습니다. 알람은 이 주소로 전달됩니다.${appUrl ? `\n${appUrl}/me` : ""}`,
    ).catch(() => "skipped" as const);
  }
  redirect(withParam(back, "test", `${channel}:${result}`));
}
