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

// ---- 서명 주소 ----
import { signedGraphUrl, verifyGraphSig } from "@/lib/aws/graph-url";

describe("Slack 본문 그래프 서명 주소", () => {
  const KEY = "0123456789abcdef0123456789abcdef";
  const now = Date.parse("2026-11-04T00:00:00Z");
  it("알람 id + 만료로 서명하고, 맞을 때만 연다", () => {
    const url = signedGraphUrl("https://hub.example/", "a1", now, KEY)!;
    expect(url).toMatch(/^https:\/\/hub\.example\/api\/g\/a1\.png\?e=\d+&s=[\w-]+$/);
    const q = new URL(url).searchParams;
    expect(verifyGraphSig("a1", q.get("e"), q.get("s"), now, KEY)).toEqual({ ok: true });
    // 다른 알람으로 바꿔 끼우면 거부
    expect(verifyGraphSig("a2", q.get("e"), q.get("s"), now, KEY)).toEqual({ ok: false, reason: "bad" });
    // 만료를 늘려 위조하면 거부
    expect(verifyGraphSig("a1", String(Number(q.get("e")) + 1), q.get("s"), now, KEY)).toEqual({ ok: false, reason: "bad" });
    // 30일 뒤에는 만료
    expect(verifyGraphSig("a1", q.get("e"), q.get("s"), now + 31 * 86400_000, KEY)).toEqual({ ok: false, reason: "expired" });
  });
  it("키나 APP_URL 이 없으면 주소를 만들지 않는다", () => {
    expect(signedGraphUrl(null, "a1", now, KEY)).toBeNull();
    expect(signedGraphUrl("https://hub.example", "a1", now, null)).toBeNull();
    expect(verifyGraphSig("a1", "1", "x", now, null)).toEqual({ ok: false, reason: "nokey" });
  });
  it("발화 기준 고정 창 — 다시 불러와도 같은 그림", () => {
    const w = buildMetricWidget({ title: "t", region: "r", raw: RAW, firedAt: new Date("2026-11-04T01:00:00Z"), aroundFiring: true })!;
    expect(w.start).toBe("2026-11-03T22:30:00.000Z");
    expect(w.end).toBe("2026-11-04T01:30:00.000Z");
  });
});

// ---- 그래프 주소는 연결된 계정에만 ----
const m = vi.hoisted(() => ({ mapFindUnique: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { awsAccountMap: { findUnique: m.mapFindUnique } } }));
vi.mock("@/server/aws", () => ({
  isHubConfigured: () => Boolean(process.env.AWS_ROLE_ARN),
  metricWidgetPng: vi.fn(),
  explainAwsError: (e: unknown) => String(e),
}));

import { graphUrlForAlert } from "@/server/graph";

describe("통지 본문에 넣을 그래프 주소", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_ROLE_ARN = "arn:aws:iam::999988887777:role/alert-hub-vercel";
    process.env.APP_URL = "https://hub.example";
    process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
    m.mapFindUnique.mockResolvedValue({ readerRoleArn: "arn:aws:iam::771283576189:role/alert-hub-reader", service: { project: { customer: { awsExternalId: "ah-x" } } } });
  });
  it("읽기 역할 + ExternalId 가 있는 계정이면 서명 주소", async () => {
    expect(await graphUrlForAlert("a1", "771283576189")).toMatch(/^https:\/\/hub\.example\/api\/g\/a1\.png\?e=/);
  });
  it("역할이 없거나 안내 데스크가 없으면 null — 그래프 없이 보낸다", async () => {
    m.mapFindUnique.mockResolvedValue({ readerRoleArn: null, service: { project: { customer: { awsExternalId: "ah-x" } } } });
    expect(await graphUrlForAlert("a1", "771283576189")).toBeNull();
    delete process.env.AWS_ROLE_ARN;
    expect(await graphUrlForAlert("a1", "771283576189")).toBeNull();
  });
});
