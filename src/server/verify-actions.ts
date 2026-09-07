"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { LINK_TTL_MS, hashCode, isVerifyChannel, newLinkToken, type VerifyChannel } from "@/lib/auth/verify";
import { sendEmailText } from "@/lib/notify/email";
import { sendSmsText } from "@/lib/notify/twilio";
import { postDm, isBotConfigured } from "@/lib/notify/slack-api";
import { requireRole } from "@/server/auth";

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

/**
 * 관리자 대리 확인 ① 요청 보내기 — 그 사람의 이메일/문자/Slack DM 으로 24시간
 * 링크를 보낸다. 로그인하지 않는 고객사 담당자용. 결과는 ?vreq=<channel>:<r>.
 */
export async function requestChannelVerification(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const contactId = str(formData, "contactId");
  const channel = str(formData, "channel");
  const back = backOf(formData, "/admin/contacts");
  if (!contactId || !isVerifyChannel(channel)) redirect(back);
  const c = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!c) redirect(back);
  const target = channel === "slack" ? c.slackId : channel === "email" ? c.email : c.phone;
  if (!target) redirect(withParam(back, "vreq", `${channel}:missing`));

  const token = newLinkToken();
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
  if (!appUrl) redirect(withParam(back, "vreq", `${channel}:noappurl`));
  const link = `${appUrl}/verify/${token}`;
  const label = channel === "slack" ? "Slack" : channel === "email" ? "이메일" : "문자";

  let result: "sent" | "skipped" = "skipped";
  try {
    if (channel === "email") {
      result = await sendEmailText(
        target,
        "[alert-hub] 알람 통지 채널 확인",
        `${c.name}님, alert-hub 알람 통지를 이 이메일로 받게 됩니다.\n아래 링크를 열어 주소가 맞는지 확인해 주세요 (24시간 유효).\n${link}\n\n요청자: ${admin?.name ?? "관리자"}`,
      );
    } else if (channel === "sms") {
      result = await sendSmsText(target, `[alert-hub] 알람 통지 번호 확인: ${link} (24시간)`);
    } else {
      if (!isBotConfigured()) result = "skipped";
      else {
        await postDm(target, `alert-hub 알람 통지 채널 확인 — 링크를 열어 주세요 (24시간): ${link}`);
        result = "sent";
      }
    }
  } catch (err) {
    console.error("[verify] request send failed", err);
    result = "skipped";
  }
  if (result === "sent") {
    await prisma.channelVerification.create({
      data: {
        contactId,
        channel,
        tokenHash: await hashCode(token, "link"),
        expiresAt: new Date(Date.now() + LINK_TTL_MS),
        requestedBy: admin?.name ?? "open",
      },
    });
  }
  revalidatePath(back);
  redirect(withParam(back, "vreq", `${channel}:${result}`));
}

/** 관리자 대리 확인 ② 수동 확인 — 전화 등으로 직접 확인한 경우. 누가·메모 기록. */
export async function manualVerifyChannel(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const contactId = str(formData, "contactId");
  const channel = str(formData, "channel");
  const note = str(formData, "note");
  const back = backOf(formData, "/admin/contacts");
  if (!contactId || !isVerifyChannel(channel)) redirect(back);
  const via = `admin:${admin?.name ?? "open"}`;
  const now = new Date();
  await prisma.contact.update({
    where: { id: contactId },
    data: {
      ...(channel === "slack"
        ? { slackVerifiedAt: now, slackVerifiedVia: via }
        : channel === "email"
          ? { emailVerifiedAt: now, emailVerifiedVia: via }
          : { phoneVerifiedAt: now, phoneVerifiedVia: via }),
      ...(note ? { verifyNote: note } : {}),
    },
  });
  revalidatePath(back);
  redirect(withParam(back, "vreq", `${channel}:manual`));
}

/** 링크 클릭 처리 — 토큰 해시로 찾아 1회 사용. 페이지에서 호출. */
export async function consumeVerificationLink(token: string): Promise<
  { ok: true; channel: VerifyChannel; name: string; already: boolean } | { ok: false; reason: "invalid" | "expired" }
> {
  const hash = await hashCode(token, "link");
  const row = await prisma.channelVerification.findUnique({ where: { tokenHash: hash }, include: { contact: true } });
  if (!row || !isVerifyChannel(row.channel)) return { ok: false, reason: "invalid" };
  if (row.usedAt) return { ok: true, channel: row.channel, name: row.contact.name, already: true };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  const now = new Date();
  await prisma.$transaction([
    prisma.channelVerification.update({ where: { id: row.id }, data: { usedAt: now } }),
    prisma.contact.update({
      where: { id: row.contactId },
      data:
        row.channel === "slack"
          ? { slackVerifiedAt: now, slackVerifiedVia: "link" }
          : row.channel === "email"
            ? { emailVerifiedAt: now, emailVerifiedVia: "link" }
            : { phoneVerifiedAt: now, phoneVerifiedVia: "link" },
    }),
  ]);
  return { ok: true, channel: row.channel, name: row.contact.name, already: false };
}
