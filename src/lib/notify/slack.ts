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
    const url = process.env.SLACK_WEBHOOK_URL;
    if (!url) return;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: buildText(alert, ctx) }),
    });

    if (!res.ok) {
      throw new Error(`Slack webhook returned ${res.status} ${res.statusText}`);
    }
  },
};
