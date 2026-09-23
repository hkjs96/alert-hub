import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildUserPrompt,
  cleanInsight,
  describeStats,
  evidenceList,
  gateInsight,
  slackInsightLine,
  suggestionLine,
  type InsightInput,
} from "@/lib/insight";
import type { PriorItem } from "@/lib/history";

// AI 메모 — 근거로만 쓰고, 근거 없는 제안은 버리고, 신뢰도는 건수로 말한다.

function prior(over: Partial<PriorItem> = {}): PriorItem {
  return {
    id: "r1", alertId: "a-old", serviceId: "s1", metric: "CPUUtilization", resource: "i-1", title: "CPU high",
    resolvedAt: new Date("2026-09-01T03:00:00Z"), durationSec: 600, via: "manual", ackedBy: "이서연", resolvedBy: "이서연",
    escalationStep: 1, muted: false, kind: "restart", note: null, recurredAt: null, tier: 1, ...over,
  };
}

function input(over: Partial<InsightInput> = {}): InsightInput {
  return {
    alert: {
      id: "a1", title: "CPU high", severity: "CRITICAL", namespace: "AWS/EC2", metric: "CPUUtilization", resource: "i-1",
      value: "97", threshold: 90, comparison: ">", region: "ap-northeast-2", stateReason: "Threshold Crossed", count: 3,
      firstSeenAt: new Date("2026-09-14T01:00:00Z"),
    },
    chainLabel: "카카오뱅크 › 코어 › 이체API",
    prior: [prior(), prior({ id: "r2", alertId: "a-old2", kind: "restart", tier: 2 }), prior({ id: "r3", alertId: "a-old3", kind: "config", tier: 3 })],
    runbook: { text: "1. 프로세스 재시작\n2. 안 되면 인스턴스 교체", source: "서비스 이체API" },
    events: [{ status: "FIRING", createdAt: new Date("2026-09-14T01:00:00Z"), reason: "Threshold Crossed" }],
    othersCount: 4,
    ...over,
  };
}

describe("근거 게이트", () => {
  it("런북이 있으면 만든다", () => {
    expect(gateInsight({ runbook: true, priorCount: 0 })).toEqual({ ok: true });
  });
  it("런북 없이 기록 2건부터", () => {
    expect(gateInsight({ runbook: false, priorCount: 2 })).toEqual({ ok: true });
    expect(gateInsight({ runbook: false, priorCount: 1 })).toMatchObject({ ok: false, reason: expect.stringContaining("1건") });
    expect(gateInsight({ runbook: false, priorCount: 0 })).toMatchObject({ ok: false, reason: expect.stringContaining("없음") });
  });
});

describe("프롬프트 재료", () => {
  it("근거 번호가 화면과 모델에서 같고, 다른 고객사는 건수만", () => {
    const inp = input();
    const ev = evidenceList(inp);
    expect(ev.map((e) => e.id)).toEqual(["E1", "E2", "E3", "R"]);
    expect(ev[0].alertId).toBe("a-old");
    const text = buildUserPrompt(inp);
    expect(text).toContain("[E1] 2026-09-01");
    expect(text).toContain("[E3]");
    expect(text).toContain("다른 고객사에 같은 유형의 기록 4건");
    expect(text).not.toContain("kakaobank.example"); // 내용 아닌 건수만
    expect(text).toContain("## 런북 [R]");
    expect(text).toContain("프로세스 재시작");
    expect(text).toContain("카카오뱅크 › 코어 › 이체API");
    expect(text).toContain("값: 97 (> 90)");
  });
  it("기록·런북·이력이 없으면 '없음'으로 정직하게", () => {
    const text = buildUserPrompt(input({ prior: [], runbook: null, events: [], othersCount: 0 }));
    expect(text).toContain("(없음)");
    expect(text).toContain("(첫 발화)");
    expect(text).not.toContain("다른 고객사");
  });
});

describe("출력 정리", () => {
  const inp = input();
  const ev = evidenceList(inp);

  it("모르는 근거를 단 단계는 버리고, 아는 근거만 남긴다", () => {
    const out = cleanInsight(
      {
        summary: "지난 세 번 중 두 번 재시작으로 풀렸다.",
        likely_cause: "프로세스 누수",
        next_steps: [
          { text: "프로세스 재시작", evidence: ["E1", "R", "E9"] },
          { text: "디스크도 확인", evidence: [] },
          { text: "커널 업그레이드", evidence: ["X"] },
          { text: "이력 보기", evidence: ["A"] },
        ],
        suggested_kind: "restart",
        confidence: "medium",
      },
      ev,
      inp.prior,
    );
    expect(out).not.toBeNull();
    expect(out!.nextSteps).toEqual([
      { text: "프로세스 재시작", evidence: ["E1", "R"] },
      { text: "이력 보기", evidence: ["A"] },
    ]);
    expect(out!.dropped).toBe(2);
    expect(out!.suggestedKind).toBe("restart");
    expect(out!.basedOn).toBe(2);
    expect(out!.confidence).toBe("medium");
  });
  it("제안 분류는 실제 기록이 2건 이상 그 분류일 때만", () => {
    const out = cleanInsight({ summary: "x", likely_cause: null, next_steps: [], suggested_kind: "config", confidence: "high" }, ev, inp.prior);
    expect(out!.suggestedKind).toBeNull();
    expect(out!.basedOn).toBe(0);
    const bad = cleanInsight({ summary: "x", likely_cause: null, next_steps: [], suggested_kind: "reboot", confidence: "zzz" }, ev, inp.prior);
    expect(bad!.suggestedKind).toBeNull();
    expect(bad!.confidence).toBe("low");
  });
  it("요약이 없거나 객체가 아니면 null", () => {
    expect(cleanInsight(null, ev, inp.prior)).toBeNull();
    expect(cleanInsight({ summary: "  " }, ev, inp.prior)).toBeNull();
  });
});

describe("표시", () => {
  it("신뢰도는 건수로", () => {
    expect(suggestionLine({ suggestedKind: "restart", basedOn: 3, priorCount: 4 })).toBe("지난 4건 중 3건 재시작");
    expect(suggestionLine({ suggestedKind: "restart", basedOn: 1, priorCount: 4 })).toBeNull();
    expect(suggestionLine({ suggestedKind: null, basedOn: 0, priorCount: 4 })).toBeNull();
  });
  it("Slack 한 줄", () => {
    const line = slackInsightLine(
      { summary: "재시작으로 풀린 알람.", nextSteps: [{ text: "프로세스 재시작", evidence: ["E1"] }], suggestedKind: "restart", basedOn: 2, priorCount: 3 },
      "https://app/alerts/a1#ai",
    );
    expect(line).toBe("🤖 AI 메모: 재시작으로 풀린 알람. · 지난 3건 중 2건 재시작 · 먼저: 프로세스 재시작 · <https://app/alerts/a1#ai|전체 보기>");
  });
  it("채점표 한 줄", () => {
    expect(describeStats({ total: 0, done: 0, skipped: 0, failed: 0, up: 0, down: 0, scored: 0, hit: 0 })).toBe("아직 만든 메모 없음");
    expect(describeStats({ total: 17, done: 12, skipped: 4, failed: 1, up: 5, down: 1, scored: 4, hit: 3 })).toBe(
      "생성 12 · 근거 부족 4 · 실패 1 · 👍 5 👎 1 · 분류 적중 3/4",
    );
  });
});

// ---- 서버: 큐·게이트·저장·스레드 ----------------------------------------------

const m = vi.hoisted(() => ({
  setting: new Map<string, string>(),
  customerFindUnique: vi.fn(),
  insightCreate: vi.fn(),
  insightFindFirst: vi.fn(),
  insightFindMany: vi.fn(),
  insightUpdateMany: vi.fn(),
  insightUpdate: vi.fn(),
  alertFindUniqueOrThrow: vi.fn(),
  eventFindMany: vi.fn(),
  resolutionCount: vi.fn(),
  slackFindMany: vi.fn(),
  findPrior: vi.fn(),
  resolveRunbook: vi.fn(),
  call: vi.fn(),
  postThread: vi.fn(),
  botConfigured: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findUnique: m.customerFindUnique },
    alertInsight: { create: m.insightCreate, findFirst: m.insightFindFirst, findMany: m.insightFindMany, updateMany: m.insightUpdateMany, update: m.insightUpdate },
    alert: { findUniqueOrThrow: m.alertFindUniqueOrThrow },
    alertEvent: { findMany: m.eventFindMany },
    resolution: { count: m.resolutionCount },
    slackMessage: { findMany: m.slackFindMany },
  },
}));
vi.mock("@/server/settings", () => ({
  getSetting: async (k: string) => m.setting.get(k) ?? null,
  setSetting: async (k: string, v: string) => { m.setting.set(k, v); },
}));
vi.mock("@/server/history", () => ({ findPriorResolutions: m.findPrior }));
vi.mock("@/server/runbook", () => ({ resolveRunbook: m.resolveRunbook }));
vi.mock("@/server/insight-client", () => ({
  callInsightModel: m.call,
  insightApiKey: () => process.env.ANTHROPIC_API_KEY ?? null,
  INSIGHT_MODEL: "claude-opus-5",
}));
vi.mock("@/lib/notify/slack-api", () => ({ isBotConfigured: m.botConfigured, postThread: m.postThread }));

import { drainDueInsights, enqueueInsight, insightPolicy, rateInsight } from "@/server/insight";

const alertRow = {
  id: "a1", title: "CPU high", description: null, severity: "CRITICAL", namespace: "AWS/EC2", metric: "CPUUtilization", resource: "i-1",
  value: "97", threshold: 90, comparison: ">", region: "ap-northeast-2", stateReason: null, count: 1, firstSeenAt: new Date(),
  customerId: "c1",
  ownershipSnapshot: {
    capturedAt: "x", level: "service",
    chain: { customerId: "c1", customerName: "카카오뱅크", projectId: "p1", projectName: "코어", serviceId: "s1", serviceName: "이체API", accountMapId: "m", accountAlias: null, environment: null },
    order: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.setting.clear();
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.AI_INSIGHTS;
  m.customerFindUnique.mockResolvedValue({ aiInsights: true });
  m.insightCreate.mockResolvedValue({ id: "i1" });
  m.insightFindFirst.mockResolvedValue(null);
  m.insightUpdateMany.mockResolvedValue({ count: 1 });
  m.insightUpdate.mockResolvedValue({});
  m.alertFindUniqueOrThrow.mockResolvedValue(alertRow);
  m.eventFindMany.mockResolvedValue([]);
  m.resolutionCount.mockResolvedValue(0);
  m.slackFindMany.mockResolvedValue([]);
  m.botConfigured.mockReturnValue(false);
  m.resolveRunbook.mockResolvedValue(null);
  m.findPrior.mockResolvedValue({ items: [], summary: {}, line: "" });
});

describe("스위치", () => {
  it("기본 꺼짐 → 환경변수 → 화면 설정 순, 키 없으면 어차피 꺼짐", async () => {
    expect(await insightPolicy()).toMatchObject({ enabled: false, source: "default" });
    process.env.AI_INSIGHTS = "on";
    expect(await insightPolicy()).toMatchObject({ enabled: true, source: "env" });
    m.setting.set("ai.insights", "off");
    expect(await insightPolicy()).toMatchObject({ enabled: false, source: "setting", switchedOn: false });
    m.setting.set("ai.insights", "on");
    delete process.env.ANTHROPIC_API_KEY;
    expect(await insightPolicy()).toMatchObject({ enabled: false, switchedOn: true, hasKey: false });
  });
  it("꺼져 있으면 큐에 아무것도 안 넣고, 고객사가 거부해도 안 넣는다", async () => {
    await enqueueInsight("a1", "c1");
    expect(m.insightCreate).not.toHaveBeenCalled();
    m.setting.set("ai.insights", "on");
    m.customerFindUnique.mockResolvedValue({ aiInsights: false });
    await enqueueInsight("a1", "c1");
    expect(m.insightCreate).not.toHaveBeenCalled();
    m.customerFindUnique.mockResolvedValue({ aiInsights: true });
    await enqueueInsight("a1", "c1");
    expect(m.insightCreate).toHaveBeenCalledWith({ data: { alertId: "a1", customerId: "c1" } });
  });
});

describe("중복·위조", () => {
  it("같은 알람의 대기 행이 있으면 하나 더 만들지 않는다 (플래핑)", async () => {
    m.setting.set("ai.insights", "on");
    m.insightFindFirst.mockResolvedValue({ id: "i0" });
    await enqueueInsight("a1", "c1");
    expect(m.insightCreate).not.toHaveBeenCalled();
  });
  it("평가는 스코프 검사한 알람의 메모일 때만", async () => {
    m.insightUpdateMany.mockResolvedValue({ count: 0 });
    expect(await rateInsight("i-other", "a1", "up", "관리자")).toBe(false);
    expect(m.insightUpdateMany).toHaveBeenCalledWith({ where: { id: "i-other", alertId: "a1" }, data: { feedback: "up", feedbackBy: "관리자" } });
  });
});

describe("드레인", () => {
  const pendingRow = { id: "i1", alertId: "a1", status: "pending", attempts: 0, nextAttemptAt: new Date(0) };

  it("근거가 없으면 모델을 부르지 않고 skipped", async () => {
    m.setting.set("ai.insights", "on");
    m.insightFindMany.mockResolvedValue([pendingRow]);
    const r = await drainDueInsights(new Date(), 3);
    expect(r).toMatchObject({ due: 1, skipped: 1, done: 0 });
    expect(m.call).not.toHaveBeenCalled();
    expect(m.insightUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "skipped", error: expect.stringContaining("근거 부족") }) }));
  });

  it("기록 2건이면 모델을 부르고, 정리해 저장하고, 봇 메시지 스레드에 한 줄", async () => {
    m.setting.set("ai.insights", "on");
    m.insightFindMany.mockResolvedValue([pendingRow]);
    m.findPrior.mockResolvedValue({ items: [prior(), prior({ id: "r2", alertId: "a-old2" })], summary: {}, line: "" });
    m.call.mockResolvedValue({
      json: {
        summary: "지난 두 번 모두 재시작으로 풀렸다.", likely_cause: null,
        next_steps: [{ text: "프로세스 재시작", evidence: ["E1"] }, { text: "커널 교체", evidence: ["Z"] }],
        suggested_kind: "restart", confidence: "high",
      },
      model: "claude-opus-5", inputTokens: 1200, outputTokens: 80, cacheReadTokens: 900,
    });
    m.botConfigured.mockReturnValue(true);
    m.slackFindMany.mockResolvedValue([{ channel: "C1", ts: "1.1" }]);
    process.env.APP_URL = "https://app";

    const r = await drainDueInsights(new Date(), 3);
    expect(r).toMatchObject({ due: 1, done: 1 });
    // 모델에는 고객사 격리된 재료만: 프롬프트에 E1·E2 가 있고 런북은 없음
    const prompt = m.call.mock.calls[0][0].user as string;
    expect(prompt).toContain("[E1]");
    expect(prompt).toContain("[E2]");
    expect(prompt).toContain("## 런북 [R]\n(없음)");
    const saved = m.insightUpdate.mock.calls.find((c) => c[0].data.status === "done")![0].data;
    expect(saved.nextSteps).toEqual([{ text: "프로세스 재시작", evidence: ["E1"] }]);
    expect(saved.suggestedKind).toBe("restart");
    expect(saved.basedOn).toBe(2);
    expect(saved.priorCount).toBe(2);
    expect(saved.inputTokens).toBe(1200);
    expect(m.postThread).toHaveBeenCalledWith({ channel: "C1", ts: "1.1" }, expect.stringContaining("🤖 AI 메모: 지난 두 번 모두 재시작으로 풀렸다."));
    expect(m.postThread.mock.calls[0][1]).toContain("<https://app/alerts/a1#ai|전체 보기>");
  });

  it("모델이 거부하면 재시도로 남기고, 5회째면 포기", async () => {
    m.setting.set("ai.insights", "on");
    m.resolveRunbook.mockResolvedValue({ url: null, text: "재시작", source: "서비스 이체API" });
    m.call.mockResolvedValue({ json: null, reason: "모델이 응답을 거부 (cyber)", model: "claude-opus-5", inputTokens: 1, outputTokens: 0, cacheReadTokens: 0 });
    m.insightFindMany.mockResolvedValue([pendingRow]);
    expect(await drainDueInsights(new Date(), 3)).toMatchObject({ retrying: 1 });
    expect(m.insightUpdateMany).toHaveBeenLastCalledWith({ where: { id: "i1" }, data: { error: "모델이 응답을 거부 (cyber)" } });

    m.insightFindMany.mockResolvedValue([{ ...pendingRow, attempts: 4 }]);
    expect(await drainDueInsights(new Date(), 3)).toMatchObject({ gaveUp: 1 });
    expect(m.insightUpdateMany).toHaveBeenLastCalledWith({
      where: { id: "i1" },
      data: { status: "failed", error: expect.stringContaining("5회 실패, 포기") },
    });
  });

  it("고객사가 거부했으면 대기 행이 있어도 모델을 부르지 않는다 (지금 생성 버튼 포함)", async () => {
    m.setting.set("ai.insights", "on");
    m.insightFindMany.mockResolvedValue([pendingRow]);
    m.resolveRunbook.mockResolvedValue({ url: null, text: "재시작", source: "서비스 이체API" });
    m.customerFindUnique.mockResolvedValue({ aiInsights: false });
    expect(await drainDueInsights(new Date(), 3)).toMatchObject({ skipped: 1, done: 0 });
    expect(m.call).not.toHaveBeenCalled();
    expect(m.insightUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "skipped", error: "고객사가 AI 메모를 껐습니다" }) }));
  });

  it("선점에 지면 손대지 않는다 (겹치는 틱)", async () => {
    m.setting.set("ai.insights", "on");
    m.insightFindMany.mockResolvedValue([pendingRow]);
    m.insightUpdateMany.mockResolvedValue({ count: 0 });
    const r = await drainDueInsights(new Date(), 3);
    expect(r).toMatchObject({ due: 1, done: 0, skipped: 0, retrying: 0 });
    expect(m.call).not.toHaveBeenCalled();
  });
});
