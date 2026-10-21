import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMetricWidget, checkReaderRole, newExternalId, parseRoleArn, probeWidget } from "@/lib/aws/graph";

// 알람 그래프: 위젯 정의·역할 검증(순수) + 드레인·Slack 업로드(모의).

const RAW = {
  AlarmName: "TEST-ALARM",
  Trigger: {
    MetricName: "CPUUtilization",
    Namespace: "AWS/EC2",
    Statistic: "AVERAGE",
    Period: 300,
    Threshold: 80,
    Dimensions: [{ name: "InstanceId", value: "i-099ec32a21de88457" }],
  },
};

describe("역할 ARN", () => {
  it("형식을 읽는다 (경로 포함)", () => {
    expect(parseRoleArn("arn:aws:iam::771283576189:role/alert-hub-reader")).toEqual({ accountId: "771283576189", name: "alert-hub-reader" });
    expect(parseRoleArn("arn:aws:iam::771283576189:role/svc/alert-hub-reader")?.name).toBe("alert-hub-reader");
    expect(parseRoleArn("arn:aws:iam::77128357618:role/x")).toBeNull();
    expect(parseRoleArn("hello")).toBeNull();
  });
  it("매핑된 계정의 alert-hub-reader 만 허용 — 남의 계정 역할로 그래프를 끌어오지 못하게", () => {
    expect(checkReaderRole("arn:aws:iam::771283576189:role/alert-hub-reader", "771283576189")).toEqual({ ok: true, arn: "arn:aws:iam::771283576189:role/alert-hub-reader" });
    expect(checkReaderRole("arn:aws:iam::111122223333:role/alert-hub-reader", "771283576189")).toMatchObject({ ok: false, reason: expect.stringContaining("다릅니다") });
    expect(checkReaderRole("arn:aws:iam::771283576189:role/Admin", "771283576189")).toMatchObject({ ok: false, reason: expect.stringContaining("alert-hub-reader") });
  });
  it("ExternalId 는 ah- 접두어 + 32자리 16진수", () => {
    expect(newExternalId(() => new Uint8Array(16).fill(171))).toBe(`ah-${"ab".repeat(16)}`);
    expect(newExternalId()).toMatch(/^ah-[0-9a-f]{32}$/);
  });
});

describe("위젯 정의", () => {
  const fired = new Date("2026-10-20T05:58:00Z");
  it("단일 지표 알람: 지표·차원·통계·주기 + 임계값·발화 표시", () => {
    const w = buildMetricWidget({ title: "TEST-ALARM", region: "ap-northeast-2", raw: RAW, firedAt: fired })!;
    expect(w.metrics).toEqual([["AWS/EC2", "CPUUtilization", "InstanceId", "i-099ec32a21de88457", { stat: "Average", period: 300 }]]);
    expect(w.annotations).toEqual({
      vertical: [{ label: "발화", value: "2026-10-20T05:58:00.000Z", color: "#d62728" }],
      horizontal: [{ label: "임계값", value: 80, color: "#ff7f0e" }],
    });
    expect(w).toMatchObject({ region: "ap-northeast-2", start: "-PT3H", timezone: "+0900" });
  });
  it("지표 수식 알람: MetricStat 선들만", () => {
    const raw = {
      Trigger: {
        Metrics: [
          { Id: "m1", Label: "5xx", MetricStat: { Metric: { Namespace: "AWS/ApplicationELB", MetricName: "HTTPCode_Target_5XX_Count", Dimensions: [{ name: "LoadBalancer", value: "app/x" }] }, Period: 60, Stat: "Sum" } },
          { Id: "e1", Expression: "m1/m2*100" },
        ],
      },
    };
    const w = buildMetricWidget({ title: "t", region: "ap-northeast-2", raw, firedAt: fired })!;
    expect(w.metrics).toEqual([["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", "app/x", { stat: "Sum", period: 60, label: "5xx" }]]);
    expect((w.annotations as { horizontal?: unknown }).horizontal).toBeUndefined();
  });
  it("그릴 게 없으면 null", () => {
    expect(buildMetricWidget({ title: "t", region: "r", raw: { Trigger: { Metrics: [{ Id: "e1", Expression: "1" }] } }, firedAt: fired })).toBeNull();
    expect(buildMetricWidget({ title: "t", region: "r", raw: { title: "generic" }, firedAt: fired })).toBeNull();
  });
  it("연결 확인용 위젯", () => {
    expect(probeWidget("ap-northeast-2")).toMatchObject({ region: "ap-northeast-2", title: "alert-hub 연결 확인" });
  });
});

// ---- 드레인 (DB·AWS·Slack 모의) ----
const m = vi.hoisted(() => ({
  alertFindMany: vi.fn(),
  alertUpdateMany: vi.fn(),
  alertUpdate: vi.fn(),
  alertFindUniqueOrThrow: vi.fn(),
  eventFindFirst: vi.fn(),
  mapFindUnique: vi.fn(),
  png: vi.fn(),
  upload: vi.fn(),
  uploadForBlocks: vi.fn(),
  updateMessage: vi.fn(),
  slackMessageUpdate: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    alert: { findMany: m.alertFindMany, updateMany: m.alertUpdateMany, update: m.alertUpdate, findUniqueOrThrow: m.alertFindUniqueOrThrow },
    alertEvent: { findFirst: m.eventFindFirst },
    awsAccountMap: { findUnique: m.mapFindUnique },
    slackMessage: { update: m.slackMessageUpdate },
  },
}));
vi.mock("@/server/aws", () => ({
  isHubConfigured: () => Boolean(process.env.AWS_ROLE_ARN),
  metricWidgetPng: m.png,
  explainAwsError: (e: unknown) => String(e),
}));
vi.mock("@/lib/notify/slack-api", async (orig) => ({ ...(await orig<typeof import("@/lib/notify/slack-api")>()), uploadImageToThread: m.upload, uploadImageForBlocks: m.uploadForBlocks, updateMessage: m.updateMessage, postThread: vi.fn().mockResolvedValue(undefined) }));

import { drainGraphs, enqueueGraph } from "@/server/graph";

describe("그래프 대기열", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_ROLE_ARN = "arn:aws:iam::999988887777:role/alert-hub-vercel";
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    m.mapFindUnique.mockResolvedValue({ readerRoleArn: "arn:aws:iam::771283576189:role/alert-hub-reader", service: { project: { customer: { awsExternalId: "ah-x" } } } });
    m.alertUpdateMany.mockResolvedValue({ count: 1 });
    m.alertFindUniqueOrThrow.mockResolvedValue({ title: "TEST-ALARM", accountId: "771283576189", region: "ap-northeast-2", raw: RAW, lastSeenAt: new Date(), firstSeenAt: new Date() });
    m.eventFindFirst.mockResolvedValue({ createdAt: new Date("2026-10-20T05:58:00Z") });
  });

  it("읽기 역할 + ExternalId 가 있는 계정만 pending", async () => {
    await enqueueGraph("a1", "771283576189");
    expect(m.alertUpdate).toHaveBeenCalledWith({ where: { id: "a1" }, data: { graphState: "pending", graphAttempts: 0, graphError: null } });
    m.alertUpdate.mockClear();
    m.mapFindUnique.mockResolvedValue({ readerRoleArn: null, service: { project: { customer: { awsExternalId: "ah-x" } } } });
    await enqueueGraph("a2", "771283576189");
    expect(m.alertUpdate).not.toHaveBeenCalled();
    delete process.env.AWS_ROLE_ARN;
    await enqueueGraph("a3", "771283576189");
    expect(m.alertUpdate).not.toHaveBeenCalled();
  });

  it("그래프를 받아 봇 메시지마다 스레드에 올리고 done", async () => {
    m.alertFindMany.mockResolvedValue([{
      id: "a1", title: "TEST-ALARM", graphAttempts: 0,
      slackMessages: [
        { channel: "C0", ts: "0.9", createdAt: new Date("2026-10-19T00:00:00Z") }, // 지난 발화 — 붙이면 안 됨
        { channel: "C1", ts: "1.1", createdAt: new Date("2026-10-20T05:58:01Z") },
      ],
    }]);
    m.png.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    expect(await drainGraphs()).toEqual({ due: 1, posted: 1, failed: 0 });
    expect(m.upload).toHaveBeenCalledTimes(1);
    expect(m.png).toHaveBeenCalledWith(expect.objectContaining({ roleArn: "arn:aws:iam::771283576189:role/alert-hub-reader", externalId: "ah-x", region: "ap-northeast-2" }));
    expect(m.upload).toHaveBeenCalledWith({ channel: "C1", ts: "1.1" }, expect.any(Uint8Array), expect.objectContaining({ filename: "alarm-graph.png" }));
    expect(m.alertUpdate).toHaveBeenLastCalledWith({ where: { id: "a1" }, data: { graphState: "done", graphError: null } });
  });

  it("새 형식 메시지면 본문 안에 이미지 블록으로 끼워 넣고, 저장된 본문도 갱신", async () => {
    const body = [{ type: "header", text: { type: "plain_text", text: "⚠️ TEST-ALARM" } }];
    m.alertFindMany.mockResolvedValue([{
      id: "a1", title: "TEST-ALARM", status: "FIRING", ackedBy: null, graphAttempts: 0,
      slackMessages: [{ id: "sm1", channel: "C1", ts: "1.1", text: "t", blocks: body, createdAt: new Date("2026-10-20T05:58:01Z") }],
    }]);
    m.png.mockResolvedValue(new Uint8Array([1]));
    m.upload.mockResolvedValue("F123");
    m.updateMessage.mockResolvedValue(undefined);
    expect(await drainGraphs()).toMatchObject({ posted: 1 });
    expect(m.upload).toHaveBeenCalledTimes(1); // 스레드에 먼저 올려 공유 상태로
    const blocks = m.updateMessage.mock.calls[0][2] as { type: string; block_id?: string; slack_file?: { id: string } }[];
    expect(blocks[0].type).toBe("header");
    expect(blocks.find((b) => b.type === "image")).toMatchObject({ block_id: "ah_graph", slack_file: { id: "F123" } });
    expect(blocks.some((b) => b.type === "actions")).toBe(true); // 버튼은 그대로
    expect(m.slackMessageUpdate.mock.calls[0][0].data.blocks).toHaveLength(2);
  });

  it("끼워 넣기가 끝내 실패하면 스레드에 첨부로 대신", async () => {
    vi.useFakeTimers();
    m.alertFindMany.mockResolvedValue([{
      id: "a1", title: "t", status: "FIRING", ackedBy: null, graphAttempts: 0,
      slackMessages: [{ id: "sm1", channel: "C1", ts: "1.1", text: "t", blocks: [{ type: "header" }], createdAt: new Date("2026-10-20T05:58:01Z") }],
    }]);
    m.png.mockResolvedValue(new Uint8Array([1]));
    m.upload.mockResolvedValue("F1");
    m.updateMessage.mockRejectedValue(new Error("slack chat.update: invalid_blocks"));
    const p = drainGraphs();
    await vi.runAllTimersAsync();
    expect(await p).toMatchObject({ posted: 1 });
    expect(m.updateMessage).toHaveBeenCalledTimes(4);
    expect(m.upload).toHaveBeenCalledWith({ channel: "C1", ts: "1.1" }, expect.any(Uint8Array), expect.anything());
    vi.useRealTimers();
  });

  it("실패는 사유를 남기고 재시도, 5회째 포기", async () => {
    m.png.mockRejectedValue(new Error("고객사 역할로 갈아타지 못했습니다"));
    m.alertFindMany.mockResolvedValue([{ id: "a1", title: "t", graphAttempts: 1, slackMessages: [{ channel: "C1", ts: "1", createdAt: new Date() }] }]);
    expect(await drainGraphs()).toMatchObject({ posted: 0, failed: 0 });
    expect(m.alertUpdate).toHaveBeenLastCalledWith({ where: { id: "a1" }, data: { graphError: "고객사 역할로 갈아타지 못했습니다" } });
    m.alertFindMany.mockResolvedValue([{ id: "a1", title: "t", graphAttempts: 4, slackMessages: [{ channel: "C1", ts: "1", createdAt: new Date() }] }]);
    expect(await drainGraphs()).toMatchObject({ failed: 1 });
    expect(m.alertUpdate).toHaveBeenLastCalledWith({ where: { id: "a1" }, data: { graphState: "failed", graphError: "고객사 역할로 갈아타지 못했습니다" } });
  });

  it("안내 데스크나 봇이 없으면 아무것도 하지 않는다", async () => {
    delete process.env.AWS_ROLE_ARN;
    expect(await drainGraphs()).toEqual({ due: 0, posted: 0, failed: 0 });
    expect(m.alertFindMany).not.toHaveBeenCalled();
  });
});
