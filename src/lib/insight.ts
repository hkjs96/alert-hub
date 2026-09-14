/**
 * AI 메모 — 순수 함수. 근거 게이트, 프롬프트 재료, 모델 출력 검증·정리, 표시 문구.
 * 원칙(docs/aiops-market.md 5·7절): 근거는 같은 고객사의 해결 기록 + 런북 + 이 알람의
 * 이력뿐. 근거 없는 제안은 버리고, 신뢰도는 모델 점수 대신 건수로 보여 준다.
 */

import { describeItem, isResolutionKind, KIND_LABELS, TIER_LABELS, type PriorItem, type ResolutionKind } from "@/lib/history";

/** 제안이 서려면 이만큼의 근거가 있어야 한다. */
export const MIN_PRIOR_FOR_SUGGESTION = 2;

export interface InsightAlert {
  id: string;
  title: string;
  description?: string | null;
  severity: string;
  namespace?: string | null;
  metric?: string | null;
  resource?: string | null;
  value?: string | null;
  threshold?: number | null;
  comparison?: string | null;
  region?: string | null;
  stateReason?: string | null;
  count: number;
  firstSeenAt: Date;
}

export interface InsightEvent {
  status: string;
  createdAt: Date;
  reason?: string | null;
}

export interface InsightInput {
  alert: InsightAlert;
  chainLabel: string | null;
  prior: PriorItem[];
  runbook: { text: string; source: string } | null;
  /** 이 알람의 최근 이벤트(오래된 것부터). */
  events: InsightEvent[];
  /** 다른 고객사에 같은 서비스 이름·메트릭의 기록이 몇 건 — 내용 없이 힌트만. */
  othersCount: number;
}

export type GateDecision = { ok: true } | { ok: false; reason: string };

/** 런북도 없고 기록도 2건 미만이면 만들 게 없다 — 비용도 아끼고 빈말도 안 한다. */
export function gateInsight(input: { runbook: boolean; priorCount: number }): GateDecision {
  if (input.runbook) return { ok: true };
  if (input.priorCount >= MIN_PRIOR_FOR_SUGGESTION) return { ok: true };
  return {
    ok: false,
    reason:
      input.priorCount === 0
        ? "근거 부족 · 런북도 이전 처리 기록도 없음"
        : `근거 부족 · 이전 처리 기록 ${input.priorCount}건 (${MIN_PRIOR_FOR_SUGGESTION}건부터)`,
  };
}

// ---- 근거 목록 ----------------------------------------------------------------

export interface EvidenceRef {
  id: string;
  label: string;
  alertId?: string;
}

function ymd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** 모델에 주는 것과 화면에 보여 주는 것이 같은 번호를 쓰도록 여기서 한 번만 만든다. */
export function evidenceList(input: Pick<InsightInput, "prior" | "runbook">): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  input.prior.forEach((r, i) => {
    out.push({ id: `E${i + 1}`, label: `${ymd(r.resolvedAt)} · ${describeItem(r)} (${TIER_LABELS[r.tier]})`, alertId: r.alertId });
  });
  if (input.runbook) out.push({ id: "R", label: `런북 (${input.runbook.source})` });
  return out;
}

// ---- 프롬프트 -----------------------------------------------------------------

export const INSIGHT_SYSTEM = `당신은 MSP(관리형 서비스 제공사) 온콜 엔지니어를 돕는 메모 작성자입니다. CloudWatch 알람 하나가 방금 발화했고, 담당자는 Slack 에서 이 메모를 먼저 읽습니다.

규칙:
- 아래에 주어진 근거(이전 처리 기록 E1…, 런북 R, 이 알람의 이력 A)만 사용합니다. 일반 지식으로 추측한 조치는 next_steps 에 넣지 않습니다.
- 모든 next_step 은 evidence 배열에 근거 id 를 하나 이상 답니다. 근거가 없는 단계는 쓰지 않습니다.
- 근거가 부족하면 summary 에 그렇게 말합니다("이전 기록이 적어 확실치 않음"). 꾸며 내지 않습니다.
- suggested_kind 는 이전 기록의 분류가 한쪽으로 뚜렷할 때만 채우고, 아니면 null.
- 한국어, 간결하게. summary 는 두 문장 이하. 담당자가 30초 안에 읽을 길이.
- 다른 고객사의 기록은 건수만 알려집니다. 내용을 안다고 가정하지 않습니다.`;

function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

/** 사용자 메시지 본문 — 알람, 근거, 이력. 표시용 evidenceList 와 같은 id 를 쓴다. */
export function buildUserPrompt(input: InsightInput): string {
  const a = input.alert;
  const lines: string[] = [];
  lines.push("## 지금 발화한 알람");
  lines.push(`- 제목: ${a.title}`);
  if (input.chainLabel) lines.push(`- 조직: ${input.chainLabel}`);
  lines.push(`- 심각도: ${a.severity}`);
  if (a.namespace || a.metric) lines.push(`- 메트릭: ${[a.namespace, a.metric].filter(Boolean).join(" / ")}`);
  if (a.resource) lines.push(`- 리소스: ${a.resource}`);
  if (a.value !== null && a.value !== undefined) {
    const cmp = a.comparison && a.threshold !== null && a.threshold !== undefined ? ` (${a.comparison} ${a.threshold})` : "";
    lines.push(`- 값: ${a.value}${cmp}`);
  }
  if (a.region) lines.push(`- 리전: ${a.region}`);
  if (a.stateReason) lines.push(`- 공급자 사유: ${a.stateReason}`);
  if (a.description) lines.push(`- 설명: ${a.description}`);
  lines.push(`- 누적 발화: ${a.count}회 (첫 수신 ${fmtTime(a.firstSeenAt)})`);

  lines.push("");
  lines.push("## 이전 처리 기록 (같은 고객사, 가까운 것부터)");
  if (input.prior.length === 0) lines.push("(없음)");
  input.prior.forEach((r, i) => {
    const parts = [
      `[E${i + 1}] ${ymd(r.resolvedAt)}`,
      TIER_LABELS[r.tier],
      `제목 "${r.title}"`,
      describeItem(r),
    ];
    if (r.note) parts.push(`메모 "${r.note}"`);
    if (r.muted) parts.push("뮤트됨");
    lines.push("- " + parts.join(" · "));
  });
  if (input.othersCount > 0) {
    lines.push(`- (참고) 다른 고객사에 같은 유형의 기록 ${input.othersCount}건 — 내용은 격리되어 제공하지 않음`);
  }

  lines.push("");
  lines.push("## 런북 [R]");
  lines.push(input.runbook ? `(출처: ${input.runbook.source})\n${input.runbook.text}` : "(없음)");

  lines.push("");
  lines.push("## 이 알람의 최근 이력 [A]");
  if (input.events.length === 0) lines.push("(첫 발화)");
  for (const e of input.events) {
    lines.push(`- ${fmtTime(e.createdAt)} ${e.status}${e.reason ? ` — ${e.reason}` : ""}`);
  }
  return lines.join("\n");
}

/** 구조화 출력 스키마. 모델이 이 모양으로만 답한다. */
export const INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "두 문장 이하. 무슨 알람이고 과거엔 어떻게 풀렸나." },
    likely_cause: { type: ["string", "null"], description: "근거가 가리키는 원인. 없으면 null." },
    next_steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          evidence: { type: "array", items: { type: "string" }, description: "근거 id (E1, R, A…)" },
        },
        required: ["text", "evidence"],
        additionalProperties: false,
      },
    },
    suggested_kind: { type: ["string", "null"], enum: ["restart", "config", "auto", "other", null] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["summary", "likely_cause", "next_steps", "suggested_kind", "confidence"],
  additionalProperties: false,
} as const;

// ---- 출력 정리 ---------------------------------------------------------------

export interface InsightStep {
  text: string;
  evidence: string[];
}

export interface CleanInsight {
  summary: string;
  likelyCause: string | null;
  nextSteps: InsightStep[];
  suggestedKind: ResolutionKind | null;
  /** 제안 분류와 같은 기록 수 (제안이 없으면 0). */
  basedOn: number;
  confidence: "low" | "medium" | "high";
  /** 버린 단계 수 — 로그·통계용. */
  dropped: number;
}

/**
 * 모델 출력을 믿지 않는다: 모르는 근거 id 를 단 단계는 버리고, 제안 분류는
 * 실제 기록이 2건 이상 그 분류일 때만 남긴다("지난 4건 중 3건 재시작").
 */
export function cleanInsight(raw: unknown, evidence: EvidenceRef[], prior: PriorItem[]): CleanInsight | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  if (!summary) return null;
  const known = new Set([...evidence.map((e) => e.id), "A"]);
  const steps: InsightStep[] = [];
  let dropped = 0;
  for (const s of Array.isArray(o.next_steps) ? o.next_steps : []) {
    if (!s || typeof s !== "object") continue;
    const text = typeof (s as { text?: unknown }).text === "string" ? (s as { text: string }).text.trim() : "";
    const ev = Array.isArray((s as { evidence?: unknown }).evidence)
      ? ((s as { evidence: unknown[] }).evidence.filter((x): x is string => typeof x === "string" && known.has(x)))
      : [];
    if (!text || ev.length === 0) {
      dropped++;
      continue;
    }
    steps.push({ text, evidence: Array.from(new Set(ev)) });
  }
  let suggestedKind: ResolutionKind | null = null;
  let basedOn = 0;
  if (isResolutionKind(o.suggested_kind)) {
    const n = prior.filter((r) => r.kind === o.suggested_kind).length;
    if (n >= MIN_PRIOR_FOR_SUGGESTION) {
      suggestedKind = o.suggested_kind;
      basedOn = n;
    }
  }
  const confidence = o.confidence === "high" || o.confidence === "medium" ? o.confidence : "low";
  return {
    summary,
    likelyCause: typeof o.likely_cause === "string" && o.likely_cause.trim() ? o.likely_cause.trim() : null,
    nextSteps: steps.slice(0, 5),
    suggestedKind,
    basedOn,
    confidence,
    dropped,
  };
}

// ---- 표시 ---------------------------------------------------------------------

/** "지난 4건 중 3건 재시작" — 제안 분류의 신뢰도는 건수로 말한다. */
export function suggestionLine(s: { suggestedKind: string | null; basedOn: number; priorCount: number }): string | null {
  if (!isResolutionKind(s.suggestedKind) || s.basedOn < MIN_PRIOR_FOR_SUGGESTION) return null;
  return `지난 ${s.priorCount}건 중 ${s.basedOn}건 ${KIND_LABELS[s.suggestedKind]}`;
}

/** Slack 스레드 한 줄. 본문은 상세 화면에. */
export function slackInsightLine(
  s: { summary: string; nextSteps: InsightStep[]; suggestedKind: string | null; basedOn: number; priorCount: number },
  detailUrl: string | null,
): string {
  const parts = [`🤖 AI 메모: ${s.summary}`];
  const sug = suggestionLine(s);
  if (sug) parts.push(sug);
  if (s.nextSteps[0]) parts.push(`먼저: ${s.nextSteps[0].text}`);
  if (detailUrl) parts.push(`<${detailUrl}|전체 보기>`);
  return parts.join(" · ");
}

export interface InsightStats {
  total: number;
  done: number;
  skipped: number;
  failed: number;
  up: number;
  down: number;
  /** 제안 분류가 있었고 실제 분류가 기록된 건 */
  scored: number;
  /** 그중 맞힌 건 */
  hit: number;
}

/** 진단 화면 한 줄: "생성 12 · 근거 부족 4 · 👍 5 👎 1 · 분류 적중 3/4" */
export function describeStats(s: InsightStats): string {
  if (s.total === 0) return "아직 만든 메모 없음";
  const parts = [`생성 ${s.done}`];
  if (s.skipped) parts.push(`근거 부족 ${s.skipped}`);
  if (s.failed) parts.push(`실패 ${s.failed}`);
  if (s.up || s.down) parts.push(`👍 ${s.up} 👎 ${s.down}`);
  if (s.scored) parts.push(`분류 적중 ${s.hit}/${s.scored}`);
  return parts.join(" · ");
}
