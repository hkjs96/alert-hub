import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MAX_ATTEMPTS, nextAttemptAt } from "@/lib/notify/backoff";
import { isBotConfigured, postThread } from "@/lib/notify/slack-api";
import { findPriorResolutions } from "@/server/history";
import { resolveRunbook } from "@/server/runbook";
import { parseOwnershipSnapshot } from "@/server/org";
import { getSetting, setSetting } from "@/server/settings";
import { callInsightModel, INSIGHT_MODEL, insightApiKey } from "@/server/insight-client";
import {
  buildUserPrompt,
  cleanInsight,
  describeStats,
  evidenceList,
  gateInsight,
  slackInsightLine,
  type EvidenceRef,
  type InsightInput,
  type InsightStats,
  type InsightStep,
} from "@/lib/insight";

// AI 메모 — 발화 팬아웃 뒤 pending 행 하나, 통지 틱(/api/cron/notify)이 만든다.
// 전부 best-effort: 여기서 무엇이 실패해도 통지·전이는 이미 끝났다.

export const AI_INSIGHTS = "ai.insights";

export interface InsightPolicy {
  enabled: boolean;
  /** 스위치가 어디서 정해졌나. */
  source: "setting" | "env" | "default";
  /** API 키가 있나 — 없으면 스위치가 켜져도 만들 수 없다. */
  hasKey: boolean;
  /** 스위치 값(키 여부와 무관). */
  switchedOn: boolean;
}

/** 화면 스위치(Setting ai.insights) → 환경변수 AI_INSIGHTS → 기본 끔. 키가 없으면 어차피 꺼짐. */
export async function insightPolicy(): Promise<InsightPolicy> {
  const hasKey = insightApiKey() !== null;
  const v = await getSetting(AI_INSIGHTS);
  if (v === "on" || v === "off") return { enabled: v === "on" && hasKey, source: "setting", hasKey, switchedOn: v === "on" };
  const env = (process.env.AI_INSIGHTS ?? "").trim().toLowerCase();
  if (env) {
    const on = env === "on" || env === "true" || env === "1";
    return { enabled: on && hasKey, source: "env", hasKey, switchedOn: on };
  }
  return { enabled: false, source: "default", hasKey, switchedOn: false };
}

export async function setInsightPolicy(on: boolean, by: string | null): Promise<void> {
  await setSetting(AI_INSIGHTS, on ? "on" : "off", by);
}

/**
 * 팬아웃 직후: 스위치가 켜져 있고 고객사가 거부하지 않았으면 pending 행을 만든다.
 * 실제 생성은 다음 틱. 고객사가 껐으면 행을 만들지 않는다(흔적도 남기지 않는 게 맞다).
 */
export async function enqueueInsight(alertId: string, customerId: string | null): Promise<void> {
  try {
    const policy = await insightPolicy();
    if (!policy.enabled) return;
    if (customerId) {
      const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { aiInsights: true } });
      if (c && !c.aiInsights) return;
    }
    // 같은 알람의 대기 행이 이미 있으면 하나로 충분하다(플래핑이 모델 호출을 쌓지 않게).
    if (await prisma.alertInsight.findFirst({ where: { alertId, status: "pending" }, select: { id: true } })) return;
    await prisma.alertInsight.create({ data: { alertId, customerId } });
  } catch (err) {
    console.error("[insight] enqueue failed", err);
  }
}

type InsightRow = Prisma.AlertInsightGetPayload<object>;

/** 근거 재료를 모은다. 조회 실패는 throw — 호출자가 재시도로 돌린다. */
async function gatherInput(alertId: string): Promise<{ input: InsightInput; evidence: EvidenceRef[]; customerId: string | null }> {
  const alert = await prisma.alert.findUniqueOrThrow({
    where: { id: alertId },
    select: {
      id: true, title: true, description: true, severity: true, namespace: true, metric: true, resource: true,
      value: true, threshold: true, comparison: true, region: true, stateReason: true, count: true, firstSeenAt: true,
      ownershipSnapshot: true, customerId: true,
    },
  });
  const snap = parseOwnershipSnapshot(alert.ownershipSnapshot);
  const customerId = snap?.chain.customerId ?? alert.customerId ?? null;
  const serviceId = snap?.chain.serviceId ?? null;
  const ruleId = (snap as { rule?: { id?: string } | null } | null)?.rule?.id ?? null;
  const [prior, runbook, events, othersCount] = await Promise.all([
    findPriorResolutions({ customerId, serviceId, metric: alert.metric, resource: alert.resource }),
    resolveRunbook({ ruleId, serviceId }),
    prisma.alertEvent.findMany({ where: { alertId }, orderBy: { createdAt: "desc" }, take: 6, select: { status: true, stateReason: true, createdAt: true } }),
    customerId && alert.metric
      ? prisma.resolution.count({ where: { customerId: { not: customerId }, namespace: alert.namespace, metric: alert.metric } })
      : Promise.resolve(0),
  ]);
  const input: InsightInput = {
    alert,
    chainLabel: snap ? `${snap.chain.customerName} › ${snap.chain.projectName} › ${snap.chain.serviceName}` : null,
    prior: prior.items,
    runbook: runbook?.text ? { text: runbook.text, source: runbook.source } : null,
    events: events.reverse().map((e) => ({ status: e.status, createdAt: e.createdAt, reason: e.stateReason })),
    othersCount,
  };
  return { input, evidence: evidenceList(input), customerId };
}

/** 한 행을 끝까지 만든다: 재료 → 게이트 → 모델 → 정리 → 저장 → Slack 스레드. */
async function produce(row: InsightRow): Promise<"done" | "skipped"> {
  const { input, evidence, customerId } = await gatherInput(row.alertId);
  // 고객사 거부는 모델을 부르기 직전에 다시 본다 — "지금 생성" 버튼, 거부 전에 쌓인 pending 행도 막는다.
  if (customerId) {
    const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { aiInsights: true } });
    if (c && !c.aiInsights) {
      await prisma.alertInsight.update({ where: { id: row.id }, data: { status: "skipped", error: "고객사가 AI 메모를 껐습니다", customerId } });
      return "skipped";
    }
  }
  const gate = gateInsight({ runbook: input.runbook !== null, priorCount: input.prior.length });
  if (!gate.ok) {
    await prisma.alertInsight.update({
      where: { id: row.id },
      data: { status: "skipped", error: gate.reason, priorCount: input.prior.length, customerId, evidence: evidence as unknown as Prisma.InputJsonValue },
    });
    return "skipped";
  }
  const res = await callInsightModel({ runbook: input.runbook?.text ?? null, user: buildUserPrompt(input) });
  const usage = { model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, cacheReadTokens: res.cacheReadTokens };
  if (res.json === null) throw new Error(res.reason ?? "응답 없음");
  const clean = cleanInsight(res.json, evidence, input.prior);
  if (!clean) throw new Error("응답 형식이 맞지 않음");
  await prisma.alertInsight.update({
    where: { id: row.id },
    data: {
      status: "done",
      error: null,
      customerId,
      summary: clean.summary,
      likelyCause: clean.likelyCause,
      evidence: evidence as unknown as Prisma.InputJsonValue,
      nextSteps: clean.nextSteps as unknown as Prisma.InputJsonValue,
      suggestedKind: clean.suggestedKind,
      basedOn: clean.basedOn,
      priorCount: input.prior.length,
      confidence: clean.confidence,
      ...usage,
    },
  });
  if (clean.dropped) console.info(`[insight] ${row.alertId}: 근거 없는 단계 ${clean.dropped}개 버림`);
  await postToSlack(row.alertId, { ...clean, priorCount: input.prior.length }, row.id);
  return "done";
}

async function postToSlack(
  alertId: string,
  s: { summary: string; nextSteps: InsightStep[]; suggestedKind: string | null; basedOn: number; priorCount: number },
  insightId: string,
): Promise<void> {
  if (!isBotConfigured()) return;
  try {
    const refs = await prisma.slackMessage.findMany({ where: { alertId }, orderBy: { createdAt: "asc" } });
    if (refs.length === 0) return;
    const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
    const text = slackInsightLine(s, appUrl ? `${appUrl}/alerts/${alertId}#ai` : null);
    for (const m of refs) await postThread({ channel: m.channel, ts: m.ts }, text);
    await prisma.alertInsight.update({ where: { id: insightId }, data: { threadPosted: true } });
  } catch (err) {
    console.error("[insight] slack thread failed", err);
  }
}

/** 낙관적 선점 — 겹치는 틱이 같은 행을 두 번 만들지 않게. */
async function claim(row: InsightRow, now: Date): Promise<boolean> {
  const attemptsMade = row.attempts + 1;
  const r = await prisma.alertInsight.updateMany({
    where: { id: row.id, status: "pending", attempts: row.attempts },
    data: { attempts: attemptsMade, nextAttemptAt: nextAttemptAt(attemptsMade, now) ?? new Date(now.getTime() + 600_000) },
  });
  return r.count > 0;
}

async function attempt(row: InsightRow, now: Date): Promise<"done" | "skipped" | "retrying" | "gave-up" | "lost"> {
  if (!(await claim(row, now))) return "lost";
  try {
    return await produce(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[insight] attempt ${row.attempts + 1} for ${row.alertId} failed`, err);
    const gaveUp = row.attempts + 1 >= MAX_ATTEMPTS;
    await prisma.alertInsight.updateMany({
      where: { id: row.id },
      data: gaveUp ? { status: "failed", error: `${message} · ${MAX_ATTEMPTS}회 실패, 포기` } : { error: message },
    });
    return gaveUp ? "gave-up" : "retrying";
  }
}

export interface InsightDrainResult {
  due: number;
  done: number;
  skipped: number;
  retrying: number;
  gaveUp: number;
}

/** due 인 pending 행을 민다. 모델 호출이 수 초씩이라 틱당 몇 개만. */
export async function drainDueInsights(now = new Date(), limit = 3, ids?: string[]): Promise<InsightDrainResult> {
  const result: InsightDrainResult = { due: 0, done: 0, skipped: 0, retrying: 0, gaveUp: 0 };
  try {
    const policy = await insightPolicy();
    if (!policy.enabled) return result;
    const rows = await prisma.alertInsight.findMany({
      where: { status: "pending", nextAttemptAt: { lte: now }, ...(ids ? { id: { in: ids } } : {}) },
      orderBy: { nextAttemptAt: "asc" },
      take: limit,
    });
    result.due = rows.length;
    for (const row of rows) {
      const o = await attempt(row, now);
      if (o === "done") result.done++;
      else if (o === "skipped") result.skipped++;
      else if (o === "retrying") result.retrying++;
      else if (o === "gave-up") result.gaveUp++;
    }
  } catch (err) {
    console.error("[insight] drain failed", err);
  }
  return result;
}

/** 상세 화면의 "지금 생성" — 새 행을 만들고 바로 시도한다(사람이 기다리는 중이니 인라인). */
export async function generateInsightNow(alertId: string): Promise<InsightDrainResult> {
  const alert = await prisma.alert.findUnique({ where: { id: alertId }, select: { customerId: true } });
  const row = await prisma.alertInsight.create({ data: { alertId, customerId: alert?.customerId ?? null } });
  return drainDueInsights(new Date(), 1, [row.id]);
}

export interface InsightView {
  id: string;
  status: string;
  error: string | null;
  summary: string | null;
  likelyCause: string | null;
  evidence: EvidenceRef[];
  nextSteps: InsightStep[];
  suggestedKind: string | null;
  basedOn: number;
  priorCount: number;
  confidence: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  feedback: string | null;
  feedbackBy: string | null;
  followed: boolean | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 이 알람의 최신 메모(있으면). 화면용. */
export async function latestInsightFor(alertId: string): Promise<InsightView | null> {
  try {
    const r = await prisma.alertInsight.findFirst({ where: { alertId }, orderBy: { createdAt: "desc" } });
    if (!r) return null;
    return {
      ...r,
      evidence: Array.isArray(r.evidence) ? (r.evidence as unknown as EvidenceRef[]) : [],
      nextSteps: Array.isArray(r.nextSteps) ? (r.nextSteps as unknown as InsightStep[]) : [],
    };
  } catch {
    return null;
  }
}

/** alertId 는 호출자가 스코프 검사한 알람 — 메모가 그 알람 것일 때만 바꾼다(남의 메모 id 위조 방지). */
export async function rateInsight(id: string, alertId: string, feedback: "up" | "down", by: string | null): Promise<boolean> {
  const r = await prisma.alertInsight.updateMany({ where: { id, alertId }, data: { feedback, feedbackBy: by } });
  return r.count > 0;
}

/** 진단 화면: 채점표. 정밀도는 "제안 분류 == 실제 분류"로 잰다. */
export async function insightStats(): Promise<{ stats: InsightStats; line: string; model: string }> {
  const empty: InsightStats = { total: 0, done: 0, skipped: 0, failed: 0, up: 0, down: 0, scored: 0, hit: 0 };
  try {
    const [total, done, skipped, failed, up, down, scored, hit] = await Promise.all([
      prisma.alertInsight.count(),
      prisma.alertInsight.count({ where: { status: "done" } }),
      prisma.alertInsight.count({ where: { status: "skipped" } }),
      prisma.alertInsight.count({ where: { status: "failed" } }),
      prisma.alertInsight.count({ where: { feedback: "up" } }),
      prisma.alertInsight.count({ where: { feedback: "down" } }),
      prisma.alertInsight.count({ where: { followed: { not: null } } }),
      prisma.alertInsight.count({ where: { followed: true } }),
    ]);
    const stats = { total, done, skipped, failed, up, down, scored, hit };
    return { stats, line: describeStats(stats), model: INSIGHT_MODEL };
  } catch {
    return { stats: empty, line: describeStats(empty), model: INSIGHT_MODEL };
  }
}
