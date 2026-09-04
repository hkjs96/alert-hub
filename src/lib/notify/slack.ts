import type { Notifier, NotifyContext } from "@/lib/notify";
import type { NormalizedAlert } from "@/lib/types";
import type { NotifyTarget } from "@/lib/notify/targets";
import { defaultBotChannel, isBotConfigured, postDm, postMessage } from "@/lib/notify/slack-api";

const SEVERITY_EMOJI: Record<string, string> = {
  "SEV-0": "🚨",
  "SEV-1": "🚨",
  "SEV-2": "🔴",
  "SEV-3": "🟠",
  "SEV-4": "🟡",
  "SEV-5": "⚪",
  UNKNOWN: "⚠️",
};

function buildText(alert: NormalizedAlert, ctx: NotifyContext): string {
  const emoji = SEVERITY_EMOJI[alert.severity] ?? "⚠️";
  const lines: string[] = [
    `${emoji} *${alert.title}* is *${alert.status}*`,
  ];

  const meta: string[] = [`severity: ${alert.severity}`, `source: ${alert.source}`];
  if (alert.resource) meta.push(`resource: ${alert.resource}`);
  if (alert.metric) meta.push(`metric: ${alert.metric}`);
  if (alert.accountId) meta.push(`account: ${alert.accountId}`);
  if (alert.region) meta.push(`region: ${alert.region}`);
  lines.push(meta.join(" · "));

  if (ctx.assignees && ctx.assignees.length > 0) {
    const [first, ...rest] = ctx.assignees;
    const who = first.slackId ? `<@${first.slackId}> (${first.name})` : first.name;
    if (ctx.escalationStep) {
      lines.push(
        `⏫ 자동 에스컬레이션 → ${ctx.escalationStep}순위 ${who} — 앞 순위가 아직 ack하지 않았습니다`,
      );
    } else {
      let line = `담당 1순위: ${who}`;
      if (rest.length) line += ` · 다음 순서: ${rest.map((a) => a.name).join(" → ")}`;
      lines.push(line);
    }
  }

  if (alert.stateReason) lines.push(`> ${alert.stateReason}`);

  // Deep link to the alert detail page when the app knows its public URL.
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
  if (appUrl && ctx.alertId) {
    lines.push(`<${appUrl}/alerts/${ctx.alertId}|Open in alert-hub>`);
  }

  return lines.join("\n");
}

async function postWebhook(url: string, text: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook returned ${res.status} ${res.statusText}`);
  }
}

/** 전사 기본 목적지: 봇 기본 채널 → 전역 웹훅 순. 둘 다 없으면 빈 배열. */
export function defaultTargets(): NotifyTarget[] {
  const out: NotifyTarget[] = [];
  const ch = defaultBotChannel();
  if (isBotConfigured() && ch) out.push({ kind: "SLACK_BOT", target: ch, label: "전사 기본" });
  const url = process.env.SLACK_WEBHOOK_URL;
  if (url) out.push({ kind: "SLACK_WEBHOOK", target: url, label: "전사 웹훅" });
  return out;
}

/** 목적지 하나에 보낸다. 봇 채널은 토큰이 없으면 건너뛴다(에러 아님). */
export async function sendToTarget(t: NotifyTarget, text: string): Promise<"sent" | "skipped"> {
  if (t.kind === "SLACK_WEBHOOK") {
    await postWebhook(t.target, text);
    return "sent";
  }
  if (!isBotConfigured()) return "skipped";
  await postMessage(t.target, text);
  return "sent";
}

/**
 * 텍스트 하나를 보낸다 — 노티파이어·다이제스트·요약이 공유. targets 가 있으면
 * 그 목적지들(스코프 채널)로, 없으면 전사 기본으로. 하나라도 나가면 "sent";
 * 한 목적지의 실패는 다른 목적지를 막지 않고 마지막에 throw 한다.
 */
export async function sendSlackText(text: string, targets?: NotifyTarget[]): Promise<"sent" | "skipped"> {
  const list = targets && targets.length ? targets : defaultTargets();
  if (!list.length) return "skipped";
  let sent = 0;
  let lastErr: unknown = null;
  for (const t of list) {
    try {
      if ((await sendToTarget(t, text)) === "sent") sent++;
    } catch (err) {
      lastErr = err;
      console.error(`[notify:slack] target ${t.label ?? t.target} failed`, err);
    }
  }
  if (sent === 0 && lastErr) throw lastErr;
  return sent ? "sent" : "skipped";
}

/** 개인 DM (봇 필요). 토큰이 없으면 "skipped". */
export async function sendSlackDm(userId: string, text: string): Promise<"sent" | "skipped"> {
  if (!isBotConfigured()) return "skipped";
  await postDm(userId, text);
  return "sent";
}

/**
 * 묶음 통지 (v2 프레임 05): 같은 서비스에서 짧은 창 안에 발화한 알람들을
 * 한 메시지로 합친다. 헤더에 건수·심각도 분포, 본문에 알람별 한 줄씩.
 */
export async function sendSlackDigest(
  items: { alert: NormalizedAlert; ctx: NotifyContext }[],
): Promise<"sent" | "skipped"> {
  if (items.length === 0) return "skipped";

  const first = items[0];
  const chain = first.ctx.chainLabel;
  const serviceName = chain ? chain.split("›").pop()!.trim() : "동일 서비스";

  const bySev = new Map<string, number>();
  for (const { alert } of items) {
    bySev.set(alert.severity, (bySev.get(alert.severity) ?? 0) + 1);
  }
  const sevSummary = [...bySev.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sev, n]) => `${sev} ${n}`)
    .join(" · ");

  const lines: string[] = [
    `🚨 *${serviceName} 알람 ${items.length}건* — ${sevSummary}`,
  ];
  if (chain) lines.push(chain);

  const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
  for (const { alert, ctx } of items) {
    const emoji = SEVERITY_EMOJI[alert.severity] ?? "⚠️";
    const meta: string[] = [];
    if (alert.stateReason) meta.push(alert.stateReason);
    else if (alert.metric) meta.push(alert.metric);
    const title =
      appUrl && ctx.alertId
        ? `<${appUrl}/alerts/${ctx.alertId}|${alert.title}>`
        : alert.title;
    lines.push(`• ${emoji} ${title}${meta.length ? ` — ${meta.join(" · ")}` : ""}`);
  }

  if (first.ctx.assignees && first.ctx.assignees.length > 0) {
    const [lead, ...rest] = first.ctx.assignees;
    const who = lead.slackId ? `<@${lead.slackId}> (${lead.name})` : lead.name;
    let line = `담당 1순위: ${who}`;
    if (rest.length) line += ` · 다음 순서: ${rest.map((a) => a.name).join(" → ")}`;
    lines.push(line);
  }
  if (appUrl) lines.push(`<${appUrl}/|대시보드 열기>`);

  return sendSlackText(lines.join("\n"), first.ctx.targets);
}

/**
 * Slack Incoming Webhook notifier. Reads SLACK_WEBHOOK_URL at call time so the
 * dashboard/ingest work fine with it unset — in that case `isConfigured()` is
 * false and the notifier is simply skipped.
 */
export const slackNotifier: Notifier = {
  name: "slack",

  // 웹훅이든 봇이든 하나라도 있으면 Slack 잡을 만든다. 실제 목적지는 발송
  // 시점에 ctx.targets(스코프 채널) → 전사 기본 순으로 정해진다.
  isConfigured() {
    return Boolean(process.env.SLACK_WEBHOOK_URL) || isBotConfigured();
  },

  async notify(alert, ctx = {}) {
    const text = buildText(alert, ctx);
    const result = await sendSlackText(text, ctx.targets);
    // 에스컬레이션은 채널 글에 더해 당사자에게 DM — 밤에 채널을 안 보고 있어도
    // 닿게. 봇이 없으면 조용히 건너뛴다.
    const target = ctx.escalationStep ? ctx.assignees?.[0] : undefined;
    if (target?.slackId) {
      try {
        await sendSlackDm(target.slackId, text);
      } catch (err) {
        console.error("[notify:slack] escalation DM failed", err);
      }
    }
    return result;
  },
};
