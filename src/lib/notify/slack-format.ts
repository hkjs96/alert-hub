/**
 * 알람 Slack 본문(Block Kit) — 순수 함수. 제목(header) · 조직/담당(section) ·
 * 2열 필드(지표·값·리소스·계정) · 짧은 맥락(context) 순. 상태 줄과 버튼은
 * slack-blocks 가 그 아래에 붙인다. 텍스트(fallback)는 알림 미리보기·웹훅 폴백용.
 */
import type { NotifyContext } from "@/lib/notify";
import type { NormalizedAlert } from "@/lib/types";
import { linksLine } from "@/lib/links";

type Block = Record<string, unknown>;

export const SEVERITY_EMOJI: Record<string, string> = {
  "SEV-0": "🚨",
  "SEV-1": "🚨",
  "SEV-2": "🔴",
  "SEV-3": "🟠",
  "SEV-4": "🟡",
  "SEV-5": "⚪",
  UNKNOWN: "⚠️",
};

const COMPARISON: Record<string, string> = {
  GreaterThanThreshold: ">",
  GreaterThanOrEqualToThreshold: "≥",
  LessThanThreshold: "<",
  LessThanOrEqualToThreshold: "≤",
  LessThanLowerOrGreaterThanUpperThreshold: "밴드 밖",
  LessThanLowerThreshold: "< 하한",
  GreaterThanUpperThreshold: "> 상한",
};

export function comparisonSymbol(op: string | null | undefined): string | null {
  if (!op) return null;
  return COMPARISON[op] ?? op;
}

export interface Datapoint {
  value: number;
  at: string | null;
}

/**
 * CloudWatch NewStateReason 의 데이터 포인트 목록을 읽는다.
 * "… datapoints [1.04 (20/10/26 05:53:00), 0.9 (20/10/26 05:52:00)] was greater …"
 * 사유 문구에 들어 있는 것만 — 많아야 평가 기간 수만큼(보통 1~5개).
 */
export function parseDatapoints(reason: string | null | undefined): Datapoint[] {
  if (!reason) return [];
  const m = reason.match(/datapoints?\s*\[([^\]]*)\]/i);
  if (!m) return [];
  const out: Datapoint[] = [];
  for (const part of m[1].matchAll(/(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*(?:\(([^)]*)\))?/g)) {
    const v = Number(part[1]);
    if (Number.isFinite(v)) out.push({ value: v, at: part[2]?.trim() ?? null });
  }
  // 사유는 최신이 앞 — 그래프는 왼→오 시간순으로.
  return out.reverse();
}

const BARS = "▁▂▃▄▅▆▇█";

/** 텍스트 스파크라인. 값이 하나뿐이면 null(선이 아니라 점이라 의미 없음). */
export function sparkline(values: number[]): string | null {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi === lo) return BARS[3].repeat(values.length);
  return values.map((v) => BARS[Math.round(((v - lo) / (hi - lo)) * (BARS.length - 1))]).join("");
}

export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs >= 1000) return Math.round(v).toLocaleString("en-US");
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return Number(v.toFixed(1)).toString();
  return Number(v.toFixed(2)).toString();
}

function field(label: string, value: string): Block {
  return { type: "mrkdwn", text: `*${label}*\n${value}` };
}

/** 사유 문구에서 "Threshold Crossed: …" 같은 기계 문장을 짧게. */
function shortReason(reason: string): string {
  const r = reason.replace(/\s*\(minimum \d+ datapoints? for [^)]*\)\.?/i, "").trim();
  return r.length > 280 ? `${r.slice(0, 277)}…` : r;
}

export interface AlertBody {
  /** 알림 미리보기·웹훅·스크린리더용 한두 줄. */
  text: string;
  blocks: Block[];
}

export function buildAlertBody(alert: NormalizedAlert, ctx: NotifyContext = {}): AlertBody {
  const emoji = SEVERITY_EMOJI[alert.severity] ?? "⚠️";
  const blocks: Block[] = [];

  const title = `${emoji} ${alert.title}`.slice(0, 150);
  blocks.push({ type: "header", text: { type: "plain_text", text: title, emoji: true } });

  // 조직 · 담당
  const head: string[] = [];
  if (ctx.chainLabel) head.push(`*${ctx.chainLabel}*`);
  if (ctx.assignees && ctx.assignees.length > 0) {
    const [first, ...rest] = ctx.assignees;
    const who = first.slackId ? `<@${first.slackId}>` : `*${first.name}*`;
    if (ctx.escalationStep) {
      head.push(`⏫ *자동 에스컬레이션* → ${ctx.escalationStep}순위 ${who} — 앞 순위가 아직 확인하지 않았습니다`);
    } else {
      head.push(`담당 1순위 ${who}${rest.length ? `  ·  다음 ${rest.map((a) => a.name).join(" → ")}` : ""}`);
    }
  } else if (!ctx.chainLabel) {
    head.push("_담당이 정해지지 않은 알람입니다 (계정 미매핑)_");
  }
  if (head.length) blocks.push({ type: "section", text: { type: "mrkdwn", text: head.join("\n") } });

  // 2열 필드: 지표 · 값 · 리소스 · 계정
  const fields: Block[] = [];
  const metric = [alert.namespace, alert.metric].filter(Boolean).join(" · ");
  if (metric) fields.push(field("지표", metric));

  const points = parseDatapoints(alert.stateReason);
  const cmp = comparisonSymbol(alert.comparison);
  const latest = points.length ? points[points.length - 1].value : alert.value !== undefined ? Number(alert.value) : NaN;
  const valueParts: string[] = [];
  if (Number.isFinite(latest)) valueParts.push(`*${formatNumber(latest)}*`);
  if (cmp && alert.threshold !== undefined) valueParts.push(`${cmp} ${formatNumber(alert.threshold)}`);
  if (valueParts.length) fields.push(field("현재값 / 임계값", valueParts.join("  ")));

  if (alert.resource) fields.push(field("리소스", `\`${alert.resource}\``));
  const where = [alert.accountId, alert.region].filter(Boolean).join(" · ");
  if (where) fields.push(field("계정 · 리전", where));
  fields.push(field("심각도", alert.severity === "UNKNOWN" ? "미지정" : alert.severity));
  if (alert.source !== "cloudwatch") fields.push(field("출처", alert.source));
  if (fields.length) blocks.push({ type: "section", fields: fields.slice(0, 10) });

  // 최근 값 흐름 (사유에 들어 있는 데이터 포인트)
  const spark = sparkline(points.map((p) => p.value));
  if (spark) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `📈 최근 ${points.length}개 값  \`${spark}\`  ${points.map((p) => formatNumber(p.value)).join(" → ")}` }],
    });
  }

  // 맥락: 사유 · 이전 처리 · 링크
  const ctxLines: string[] = [];
  if (alert.stateReason) ctxLines.push(shortReason(alert.stateReason));
  if (ctx.history && !ctx.escalationStep) ctxLines.push(ctx.history);
  const links = ctx.links ? linksLine(ctx.links) : null;
  if (links) ctxLines.push(links);
  for (const line of ctxLines) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: line }] });

  const textParts = [`${emoji} ${alert.title} — ${alert.status}`];
  if (ctx.chainLabel) textParts.push(ctx.chainLabel);
  if (valueParts.length) textParts.push(valueParts.join(" ").replace(/\*/g, ""));
  return { text: textParts.join(" · "), blocks };
}
