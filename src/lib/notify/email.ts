import nodemailer from "nodemailer";
import type { Notifier, NotifyContext } from "@/lib/notify";
import type { NormalizedAlert } from "@/lib/types";

// 이메일 채널 (Phase 3). Slack과 같은 Notifier 인터페이스 뒤에 서고, 같은
// 순간(FIRING 전환 1회 + 에스컬레이션)에만 발송된다. SMTP라 벤더 중립 —
// SES/Gmail/사내 릴레이 어디든 env만 바꾸면 된다.
//
// Slack과 달리 수신자가 없으면 보낼 곳이 없다: 담당 해석이 안 됐거나 이메일이
// 등록되지 않은 알람은 조용히 건너뛴다 (Slack 채널 통지가 그 몫을 한다).

function buildSubject(alert: NormalizedAlert, ctx: NotifyContext): string {
  const prefix = ctx.escalationStep
    ? `[에스컬레이션 ${ctx.escalationStep}순위]`
    : `[${alert.status}]`;
  return `${prefix} ${alert.title}`;
}

function buildText(alert: NormalizedAlert, ctx: NotifyContext): string {
  const lines: string[] = [];
  if (ctx.escalationStep && ctx.assignees?.[0]) {
    lines.push(
      `자동 에스컬레이션: 앞 순위가 아직 ack하지 않아 ${ctx.escalationStep}순위 ${ctx.assignees[0].name}님에게 알립니다.`,
      "",
    );
  }
  lines.push(`${alert.title} — ${alert.status}`);

  const meta: string[] = [`severity: ${alert.severity}`, `source: ${alert.source}`];
  if (alert.resource) meta.push(`resource: ${alert.resource}`);
  if (alert.metric) meta.push(`metric: ${alert.metric}`);
  if (alert.accountId) meta.push(`account: ${alert.accountId}`);
  if (alert.region) meta.push(`region: ${alert.region}`);
  lines.push(meta.join(" · "));

  if (alert.stateReason) lines.push("", alert.stateReason);

  const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
  if (appUrl && ctx.alertId) {
    lines.push("", `상세: ${appUrl}/alerts/${ctx.alertId}`);
  }
  return lines.join("\n");
}

/**
 * SMTP email notifier. Reads env at call time (like the Slack notifier) so the
 * app runs fine with it unset. To = 1순위(이메일이 있는 첫 사람), Cc = 나머지
 * — 통지의 책임자가 To 한 명으로 분명해진다.
 */
export const emailNotifier: Notifier = {
  name: "email",

  isConfigured() {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
  },

  async notify(alert, ctx = {}) {
    const from = process.env.SMTP_FROM;
    const host = process.env.SMTP_HOST;
    if (!host || !from) return "skipped";

    const recipients = (ctx.assignees ?? [])
      .map((a) => a.email)
      .filter((e): e is string => Boolean(e));
    if (recipients.length === 0) return "skipped";

    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
        : undefined,
    });

    const [to, ...cc] = recipients;
    await transport.sendMail({
      from,
      to,
      cc: cc.length ? cc : undefined,
      subject: buildSubject(alert, ctx),
      text: buildText(alert, ctx),
    });
    return "sent";
  },
};

/**
 * 알람과 무관한 단문 메일 (통지 채널 테스트 발송 등). SMTP 미설정이면 "skipped".
 */
export async function sendEmailText(to: string, subject: string, text: string): Promise<"sent" | "skipped"> {
  const from = process.env.SMTP_FROM;
  const host = process.env.SMTP_HOST;
  if (!host || !from) return "skipped";
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
      : undefined,
  });
  await transport.sendMail({ from, to, subject, text });
  return "sent";
}
