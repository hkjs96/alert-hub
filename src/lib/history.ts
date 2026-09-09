/**
 * 해결 기록(사실 층) — 순수 함수. "이전 처리" 카드·Slack 한 줄·요약의 계산.
 * 검색 키는 같은 고객사 안에서 서비스+메트릭+리소스 → 서비스+메트릭 → 서비스.
 */

export const RESOLUTION_KINDS = ["restart", "config", "auto", "other"] as const;
export type ResolutionKind = (typeof RESOLUTION_KINDS)[number];

export const KIND_LABELS: Record<ResolutionKind, string> = {
  restart: "재시작",
  config: "설정/용량 변경",
  auto: "저절로 회복",
  other: "기타",
};

export function isResolutionKind(v: unknown): v is ResolutionKind {
  return typeof v === "string" && (RESOLUTION_KINDS as readonly string[]).includes(v);
}

export interface ResolutionLite {
  id: string;
  alertId: string;
  serviceId: string | null;
  metric: string | null;
  resource: string | null;
  title: string;
  resolvedAt: Date;
  durationSec: number;
  via: string;
  ackedBy: string | null;
  resolvedBy: string | null;
  escalationStep: number;
  muted: boolean;
  kind: string | null;
  note: string | null;
  recurredAt: Date | null;
}

export interface CurrentKey {
  serviceId: string | null;
  metric: string | null;
  resource: string | null;
}

/** 1 = 같은 서비스·메트릭·리소스, 2 = 같은 서비스·메트릭, 3 = 같은 서비스, 0 = 무관. */
export function tierOf(r: Pick<ResolutionLite, "serviceId" | "metric" | "resource">, cur: CurrentKey): 0 | 1 | 2 | 3 {
  if (!cur.serviceId || r.serviceId !== cur.serviceId) return 0;
  const sameMetric = Boolean(cur.metric) && r.metric === cur.metric;
  if (sameMetric && Boolean(cur.resource) && r.resource === cur.resource) return 1;
  if (sameMetric) return 2;
  return 3;
}

export const TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: "같은 리소스·메트릭",
  2: "같은 메트릭",
  3: "같은 서비스",
};

export interface PriorItem extends ResolutionLite {
  tier: 1 | 2 | 3;
}

/** 후보(같은 고객사·최근순)에서 가까운 것부터 limit 개. 같은 티어 안에서는 최근순. */
export function pickPrior(candidates: ResolutionLite[], cur: CurrentKey, limit = 5): PriorItem[] {
  const scored: PriorItem[] = [];
  for (const r of candidates) {
    const tier = tierOf(r, cur);
    if (tier === 0) continue;
    scored.push({ ...r, tier });
  }
  scored.sort((a, b) => a.tier - b.tier || b.resolvedAt.getTime() - a.resolvedAt.getTime());
  return scored.slice(0, limit);
}

export interface HistorySummary {
  count: number;
  autoCount: number;
  byKind: Partial<Record<ResolutionKind, number>>;
  medianMin: number | null;
  recurred: number;
}

export function summarize(items: ResolutionLite[]): HistorySummary {
  const byKind: Partial<Record<ResolutionKind, number>> = {};
  let autoCount = 0;
  let recurred = 0;
  const durs: number[] = [];
  for (const r of items) {
    if (r.via === "auto") autoCount++;
    if (r.recurredAt) recurred++;
    if (isResolutionKind(r.kind)) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    durs.push(r.durationSec);
  }
  durs.sort((a, b) => a - b);
  const medianMin = durs.length ? Math.round(durs[Math.floor((durs.length - 1) / 2)] / 60) : null;
  return { count: items.length, autoCount, byKind, medianMin, recurred };
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}초`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h}시간 ${m}분` : `${h}시간`;
  const d = Math.floor(h / 24);
  return `${d}일 ${h % 24}시간`;
}

/** 사람이 읽는 한 건: "이서연 · 42분 · 재시작" / "자동 회복 · 11분". */
export function describeItem(r: ResolutionLite): string {
  const parts: string[] = [];
  if (r.via === "auto") parts.push("자동 회복");
  else parts.push(r.resolvedBy ?? r.ackedBy ?? "담당자");
  parts.push(formatDuration(r.durationSec));
  if (isResolutionKind(r.kind) && !(r.via === "auto" && r.kind === "auto")) parts.push(KIND_LABELS[r.kind]);
  if (r.escalationStep > 1) parts.push(`${r.escalationStep}순위까지`);
  if (r.recurredAt) parts.push("24h 내 재발");
  return parts.join(" · ");
}

/** 요약 한 줄: "지난 4건 · 자동 회복 3 · 재시작 1 · 중간 12분". */
export function describeSummary(s: HistorySummary): string {
  if (s.count === 0) return "이전 처리 기록 없음 · 처음 보는 알람";
  const parts = [`지난 ${s.count}건`];
  if (s.autoCount) parts.push(`자동 회복 ${s.autoCount}`);
  for (const k of RESOLUTION_KINDS) {
    if (k === "auto") continue;
    const n = s.byKind[k];
    if (n) parts.push(`${KIND_LABELS[k]} ${n}`);
  }
  if (s.medianMin !== null) parts.push(`중간 ${formatDuration(s.medianMin * 60)}`);
  if (s.recurred) parts.push(`재발 ${s.recurred}`);
  return parts.join(" · ");
}

function shortDate(d: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(d).replace(/\.\s?/g, "/").replace(/\/$/, "");
}

/** Slack 본문에 붙는 한 줄. 최근 1건의 처리와 요약. */
export function priorLine(items: ResolutionLite[]): string {
  const s = summarize(items);
  if (s.count === 0) return "🕘 이전 처리 기록 없음 · 처음 보는 알람";
  const latest = [...items].sort((a, b) => b.resolvedAt.getTime() - a.resolvedAt.getTime())[0];
  const note = latest.note ? ` "${latest.note}"` : "";
  return `🕘 ${describeSummary(s)} · 최근: ${describeItem(latest)}${note} (${shortDate(latest.resolvedAt)})`;
}
