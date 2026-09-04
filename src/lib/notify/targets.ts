// 통지 목적지 — 순수 타입과 해석. 스코프별 채널 목록을 받아 "가장 구체적인
// 스코프에 하나라도 있으면 그 목록, 없으면 상위" 규칙으로 고른다(담당자
// 배정과 같은 규칙). 어디에도 없으면 빈 배열 → 발송기가 전사 기본으로 폴백.

export type TargetKind = "SLACK_BOT" | "SLACK_WEBHOOK";

export interface NotifyTarget {
  kind: TargetKind;
  /** SLACK_BOT: 채널 ID 또는 #이름. SLACK_WEBHOOK: URL. */
  target: string;
  label?: string;
  /** 어느 스코프에서 왔는지 (표시용). */
  level?: "service" | "project" | "customer";
}

export interface ScopeTargets {
  service: NotifyTarget[];
  project: NotifyTarget[];
  customer: NotifyTarget[];
}

export function resolveTargets(s: ScopeTargets): NotifyTarget[] {
  if (s.service.length) return s.service.map((t) => ({ ...t, level: "service" }));
  if (s.project.length) return s.project.map((t) => ({ ...t, level: "project" }));
  if (s.customer.length) return s.customer.map((t) => ({ ...t, level: "customer" }));
  return [];
}

export function isWebhookUrl(v: string): boolean {
  return /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(v.trim());
}

/** 봇 채널 입력 정규화: "#name" 그대로, "C…/G…" ID 그대로, 그 외 "#"을 붙인다. */
export function normalizeBotChannel(v: string): string {
  const t = v.trim();
  if (!t) return t;
  if (/^[CG][A-Z0-9]{6,}$/.test(t)) return t;
  return t.startsWith("#") ? t : `#${t}`;
}

export function describeTarget(t: NotifyTarget): string {
  if (t.kind === "SLACK_WEBHOOK") {
    const m = t.target.match(/services\/([^/]+)\//);
    return `외부 웹훅${m ? ` (${m[1]})` : ""}`;
  }
  return t.target;
}
