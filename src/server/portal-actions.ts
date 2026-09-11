"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { resolveWindow } from "@/lib/silence-window";
import { isWebhookUrl, normalizeBotChannel } from "@/lib/notify/targets";
import { sendToTarget } from "@/lib/notify/slack";
import { isBotConfigured } from "@/lib/notify/slack-api";
import {
  assertOwnedChannel,
  assertOwnedContact,
  assertOwnedScope,
  assertOwnedSilence,
  audit,
  requirePortal,
} from "@/server/portal";

// 고객사 포털의 쓰기 액션. 규칙 셋을 모든 함수가 지킨다:
//   ① requirePortal(grant) 로 시작 — 고객사 계정 + 그 권한이 켜져 있어야 한다.
//   ② 고객사 id 는 폼이 아니라 ctx(세션)에서만 온다. formData 의 customerId 는 읽지 않는다.
//   ③ 대상 id 는 assertOwned*() 로 소유를 확인한 뒤에만 건드린다.
// 그래서 위조한 요청으로 남의 회사 행을 만지려 하면 "우리 회사의 항목이 아닙니다"로 끝난다.

function str(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}
function required(fd: FormData, k: string): string {
  const v = str(fd, k);
  if (!v) throw new Error(`필수 값이 비었습니다: ${k}`);
  return v;
}
function done() {
  revalidatePath("/portal");
  revalidatePath("/");
}

/** redirect() 는 특수 예외로 흐름을 끊는다 — 삼키면 이동이 안 된다. */
function isRedirect(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/**
 * 권한·소유 거부와 입력 오류를 화면의 빨간 띠로 돌려준다 — 고객사 사용자에게
 * Next 기본 에러 화면을 보여 주지 않기 위해. 거부 사유는 서버 로그에도 남는다.
 */
async function guard(action: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (isRedirect(err)) throw err;
    const message = err instanceof Error ? err.message : "처리하지 못했습니다";
    console.warn(`[portal] ${action} rejected: ${message}`);
    redirect(`/portal?err=${encodeURIComponent(message.slice(0, 160))}`);
  }
}

// --- 담당자 ------------------------------------------------------------------

export async function portalCreateContact(formData: FormData) {
  await guard("portalCreateContact", async () => {
    const ctx = await requirePortal("contacts");
    const name = required(formData, "name");
    const created = await prisma.contact.create({
      data: {
        name,
        department: str(formData, "department"),
        email: str(formData, "email"),
        slackId: str(formData, "slackId"),
        phone: normalizePhone(str(formData, "phone")),
        // 고객사가 만든 계정은 언제나 조회 전용 · 그 고객사 소속.
        customerId: ctx.customerId,
        role: "VIEWER",
      },
      select: { id: true },
    });
    await audit(ctx, { action: "portal.contact.create", targetId: created.id, target: name });
    done();
  });
}

export async function portalUpdateContact(formData: FormData) {
  await guard("portalUpdateContact", async () => {
    const ctx = await requirePortal("contacts");
    const id = required(formData, "id");
    await assertOwnedContact(ctx.customerId, id);
    const name = required(formData, "name");
    const active = formData.get("active") === "on";
    await prisma.contact.update({
      where: { id },
      data: {
        name,
        department: str(formData, "department"),
        email: str(formData, "email"),
        slackId: str(formData, "slackId"),
        phone: normalizePhone(str(formData, "phone")),
        active,
        // 소속·역할은 고객사가 바꿀 수 없다 (조회 전용 고정).
      },
    });
    await audit(ctx, {
      action: "portal.contact.update",
      targetId: id,
      target: name,
      detail: active ? "활성" : "비활성",
    });
    done();
  });
}

// --- 점검 창 -----------------------------------------------------------------

export async function portalCreateSilence(formData: FormData) {
  await guard("portalCreateSilence", async () => {
    const ctx = await requirePortal("silences");
    const [level, scopeId] = required(formData, "levelScope").split(":", 2);
    if (!level || !scopeId) throw new Error("범위를 고르세요");
    const scope = await assertOwnedScope(ctx.customerId, level, scopeId);
    const reason = required(formData, "reason");
    const window = resolveWindow(required(formData, "preset"), new Date(), {
      endsAt: str(formData, "endsAt"),
    });
    const created = await prisma.silence.create({
      data: { ...scope, ...window, reason, createdBy: `${ctx.user.name} (${ctx.customerName})` },
      select: { id: true },
    });
    await audit(ctx, {
      action: "portal.silence.create",
      targetId: created.id,
      target: reason,
      detail: `${window.startsAt.toISOString().slice(0, 16)}Z → ${window.endsAt.toISOString().slice(0, 16)}Z`,
    });
    done();
    revalidatePath("/admin/silences");
  });
}

export async function portalRevokeSilence(formData: FormData) {
  await guard("portalRevokeSilence", async () => {
    const ctx = await requirePortal("silences");
    const id = required(formData, "id");
    const { reason } = await assertOwnedSilence(ctx.customerId, id);
    await prisma.silence.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(ctx, { action: "portal.silence.revoke", targetId: id, target: reason });
    done();
    revalidatePath("/admin/silences");
  });
}

// --- Slack 채널 --------------------------------------------------------------

export async function portalCreateChannel(formData: FormData) {
  await guard("portalCreateChannel", async () => {
    const ctx = await requirePortal("channels");
    const [level, scopeId] = required(formData, "levelScope").split(":", 2);
    if (!level || !scopeId) throw new Error("범위를 고르세요");
    const scope = await assertOwnedScope(ctx.customerId, level, scopeId);
    const kind = required(formData, "kind");
    if (kind !== "SLACK_BOT" && kind !== "SLACK_WEBHOOK") throw new Error("종류가 잘못됐습니다");
    const label = required(formData, "label");
    const raw = required(formData, "target");
    let target = raw;
    if (kind === "SLACK_WEBHOOK") {
      if (!isWebhookUrl(raw)) throw new Error("Slack Incoming Webhook URL 형식이 아닙니다 (https://hooks.slack.com/services/…)");
    } else {
      if (!isBotConfigured()) throw new Error("MSP 쪽 Slack 봇이 설정되지 않았습니다 — 웹훅 종류로 등록하세요");
      target = normalizeBotChannel(raw);
    }
    const created = await prisma.notifyChannel.create({ data: { kind, label, target, ...scope }, select: { id: true } });
    await audit(ctx, { action: "portal.channel.create", targetId: created.id, target: label, detail: `${kind} ${target}` });
    done();
    revalidatePath("/admin/org");
  });
}

export async function portalToggleChannel(formData: FormData) {
  await guard("portalToggleChannel", async () => {
    const ctx = await requirePortal("channels");
    const id = required(formData, "id");
    const { label } = await assertOwnedChannel(ctx.customerId, id);
    const cur = await prisma.notifyChannel.findUnique({ where: { id }, select: { enabled: true } });
    if (!cur) return;
    await prisma.notifyChannel.update({ where: { id }, data: { enabled: !cur.enabled } });
    await audit(ctx, { action: "portal.channel.toggle", targetId: id, target: label, detail: cur.enabled ? "끔" : "켬" });
    done();
    revalidatePath("/admin/org");
  });
}

export async function portalDeleteChannel(formData: FormData) {
  await guard("portalDeleteChannel", async () => {
    const ctx = await requirePortal("channels");
    const id = required(formData, "id");
    const { label } = await assertOwnedChannel(ctx.customerId, id);
    await prisma.notifyChannel.delete({ where: { id } });
    await audit(ctx, { action: "portal.channel.delete", targetId: id, target: label });
    done();
    revalidatePath("/admin/org");
  });
}

/** 테스트 발송 — 결과는 채널 행의 lastOkAt/lastError 에 남는다. */
export async function portalTestChannel(formData: FormData) {
  await guard("portalTestChannel", async () => {
    const ctx = await requirePortal("channels");
    const id = required(formData, "id");
    await assertOwnedChannel(ctx.customerId, id);
    const ch = await prisma.notifyChannel.findUnique({ where: { id } });
    if (!ch) return;
    try {
      const r = await sendToTarget(
        { kind: ch.kind, target: ch.target, label: ch.label },
        `:white_check_mark: alert-hub 테스트 — "${ch.label}" 채널이 ${ctx.customerName} 통지 목적지로 연결되었습니다. (${ctx.user.name})`,
      );
      await prisma.notifyChannel.update({
        where: { id },
        data: r === "sent" ? { lastOkAt: new Date(), lastError: null } : { lastError: "봇 토큰이 없어 보내지 못했습니다" },
      });
      await audit(ctx, { action: "portal.channel.test", targetId: id, target: ch.label, detail: r });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.notifyChannel.update({ where: { id }, data: { lastError: message.slice(0, 300) } });
      await audit(ctx, { action: "portal.channel.test", targetId: id, target: ch.label, detail: `실패: ${message.slice(0, 120)}` });
    }
    done();
    revalidatePath("/admin/org");
  });
}
