import type { Notifier, NotifyContext } from "@/lib/notify";
import type { NormalizedAlert } from "@/lib/types";

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

/** 웹훅으로 텍스트 하나를 보낸다 — 노티파이어·다이제스트·요약이 공유. */
export async function sendSlackText(text: string): Promise<"sent" | "skipped"> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return "skipped";
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook returned ${res.status} ${res.statusText}`);
  }
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

  return sendSlackText(lines.join("\n"));
}

/**
 * Slack Incoming Webhook notifier. Reads SLACK_WEBHOOK_URL at call time so the
 * dashboard/ingest work fine with it unset — in that case `isConfigured()` is
 * false and the notifier is simply skipped.
 */
export const slackNotifier: Notifier = {
  name: "slack",

  isConfigured() {
    return Boolean(process.env.SLACK_WEBHOOK_URL);
  },

  async notify(alert, ctx = {}) {
    return sendSlackText(buildText(alert, ctx));
  },
};
