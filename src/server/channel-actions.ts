"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isWebhookUrl, normalizeBotChannel } from "@/lib/notify/targets";
import { sendToTarget } from "@/lib/notify/slack";
import { isBotConfigured } from "@/lib/notify/slack-api";
import { requireRole } from "@/server/auth";

function str(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}
function revalidate(fd: FormData) {
  revalidatePath("/admin/org");
  const back = fd.get("back");
  if (typeof back === "string" && back.startsWith("/")) revalidatePath(back);
}

/** 스코프에 통지 채널 추가. 종류에 따라 입력을 검증·정규화한다. */
export async function createNotifyChannel(formData: FormData) {
  await requireRole("ADMIN");
  const level = str(formData, "level");
  const scopeId = str(formData, "scopeId");
  const kind = str(formData, "kind");
  const label = str(formData, "label");
  const raw = str(formData, "target");
  if (!level || !scopeId || !label || !raw) throw new Error("필수 값이 비었습니다");
  if (kind !== "SLACK_BOT" && kind !== "SLACK_WEBHOOK") throw new Error("종류가 잘못됐습니다");
  let target = raw;
  if (kind === "SLACK_WEBHOOK") {
    if (!isWebhookUrl(raw)) throw new Error("Slack Incoming Webhook URL 형식이 아닙니다 (https://hooks.slack.com/services/…)");
  } else {
    if (!isBotConfigured()) throw new Error("SLACK_BOT_TOKEN 이 없어 봇 채널을 쓸 수 없습니다 — 웹훅 종류를 쓰거나 토큰을 설정하세요");
    target = normalizeBotChannel(raw);
  }
  const scope =
    level === "service" ? { serviceId: scopeId } : level === "project" ? { projectId: scopeId } : { customerId: scopeId };
  await prisma.notifyChannel.create({ data: { kind, label, target, ...scope } });
  revalidate(formData);
}

export async function deleteNotifyChannel(formData: FormData) {
  await requireRole("ADMIN");
  const id = str(formData, "id");
  if (!id) return;
  await prisma.notifyChannel.delete({ where: { id } });
  revalidate(formData);
}

export async function toggleNotifyChannel(formData: FormData) {
  await requireRole("ADMIN");
  const id = str(formData, "id");
  if (!id) return;
  const cur = await prisma.notifyChannel.findUnique({ where: { id } });
  if (!cur) return;
  await prisma.notifyChannel.update({ where: { id }, data: { enabled: !cur.enabled } });
  revalidate(formData);
}

/** 테스트 메시지 — 결과를 lastOkAt/lastError 에 남긴다. */
export async function testNotifyChannel(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const id = str(formData, "id");
  if (!id) return;
  const ch = await prisma.notifyChannel.findUnique({ where: { id } });
  if (!ch) return;
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "") ?? "";
  try {
    const r = await sendToTarget(
      { kind: ch.kind, target: ch.target, label: ch.label },
      `:white_check_mark: alert-hub 테스트 — 이 채널이 "${ch.label}" 통지 목적지로 연결되었습니다.${admin ? ` (${admin.name})` : ""}${appUrl ? ` ${appUrl}/admin/org` : ""}`,
    );
    await prisma.notifyChannel.update({
      where: { id },
      data: r === "sent" ? { lastOkAt: new Date(), lastError: null } : { lastError: "봇 토큰이 없어 보내지 못했습니다" },
    });
  } catch (err) {
    await prisma.notifyChannel.update({
      where: { id },
      data: { lastError: err instanceof Error ? err.message.slice(0, 200) : String(err) },
    });
  }
  revalidate(formData);
}
