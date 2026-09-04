"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isRole, ROLE_LABELS } from "@/lib/auth/roles";
import { sendSlackText } from "@/lib/notify/slack";
import { sendEmailText } from "@/lib/notify/email";
import { requireRole, requireSessionUser, requireUser } from "@/server/auth";
import { VERIFY_TTL_MS, checkCode, generateCode, hashCode } from "@/lib/auth/verify";

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

/**
 * 통지 채널 확인 ① 코드 보내기 — Slack DM 멘션 또는 이메일로 6자리 코드를
 * 보내고 해시만 저장한다(10분). 서버에 채널이 없으면 "skipped".
 */
export async function sendVerificationCode(formData: FormData) {
  const me = await requireUser();
  const channel = str(formData, "channel");
  const back = backOf(formData, "/me");
  if (!me) redirect(back);
  if (channel !== "slack" && channel !== "email") redirect(back);
  const target = channel === "slack" ? me.slackId : me.email;
  if (!target) redirect(withParam(back, "verify", `${channel}:missing`));
  const code = generateCode();
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "") ?? "";
  let result: "sent" | "skipped" = "skipped";
  if (channel === "slack") {
    result = await sendSlackText(
      `<@${target}> alert-hub 채널 확인 코드: *${code}* (10분 안에 입력)${appUrl ? ` · ${appUrl}/me` : ""}`,
    ).catch(() => "skipped" as const);
  } else {
    result = await sendEmailText(
      target,
      `[alert-hub] 채널 확인 코드 ${code}`,
      `alert-hub 이메일 채널 확인 코드: ${code}\n10분 안에 입력하세요.${appUrl ? `\n${appUrl}/me` : ""}`,
    ).catch(() => "skipped" as const);
  }
  if (result === "sent") {
    await prisma.contact.update({
      where: { id: me.id },
      data: {
        verifyChannel: channel,
        verifyCodeHash: await hashCode(code, me.id),
        verifyExpiresAt: new Date(Date.now() + VERIFY_TTL_MS),
      },
    });
  }
  redirect(withParam(back, "verify", `${channel}:${result}`));
}

/** 통지 채널 확인 ② 코드 입력 — 맞으면 해당 채널의 verifiedAt 을 찍는다. */
export async function confirmVerificationCode(formData: FormData) {
  const me = await requireUser();
  const channel = str(formData, "channel");
  const back = backOf(formData, "/me");
  if (!me) redirect(back);
  if (channel !== "slack" && channel !== "email") redirect(back);
  const row = await prisma.contact.findUnique({
    where: { id: me.id },
    select: { verifyChannel: true, verifyCodeHash: true, verifyExpiresAt: true },
  });
  const ok = await checkCode({
    input: str(formData, "code") ?? "",
    hash: row?.verifyCodeHash ?? null,
    salt: me.id,
    expiresAt: row?.verifyExpiresAt ?? null,
    channel: row?.verifyChannel ?? null,
    expectedChannel: channel,
  });
  if (!ok) redirect(withParam(back, "verify", `${channel}:bad`));
  await prisma.contact.update({
    where: { id: me.id },
    data: {
      ...(channel === "slack" ? { slackVerifiedAt: new Date() } : { emailVerifiedAt: new Date() }),
      verifyChannel: null,
      verifyCodeHash: null,
      verifyExpiresAt: null,
    },
  });
  revalidatePath("/me");
  revalidatePath("/welcome");
  revalidatePath("/", "layout");
  redirect(withParam(back, "verify", `${channel}:ok`));
}
