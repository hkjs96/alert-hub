import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ingestAlerts: vi.fn(),
  // 계정 → 고객사 매핑과 고객사 수집 토큰 (테스트마다 채운다)
  accounts: new Map<string, string>(),
  tokens: new Map<string, string>(),
  rejections: [] as { kind: string; reason: string; accountId: string | null }[],
}));

vi.mock("@/server/alerts", () => ({ ingestAlerts: mocks.ingestAlerts }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    awsAccountMap: {
      findMany: async ({ where }: { where: { accountId: { in: string[] } } }) =>
        where.accountId.in
          .filter((a) => mocks.accounts.has(a))
          .map((a) => ({ accountId: a, service: { project: { customerId: mocks.accounts.get(a) } } })),
    },
    customer: { findUnique: async ({ where }: { where: { ingestToken: string } }) => (mocks.tokens.has(where.ingestToken) ? { id: mocks.tokens.get(where.ingestToken) } : null) },
    ingestRejection: { create: async ({ data }: { data: { kind: string; reason: string; accountId: string | null } }) => { mocks.rejections.push(data); return data; } },
  },
}));

import { POST } from "@/app/api/webhooks/[provider]/route";

function post(
  provider: string,
  body: unknown,
  opts: { headers?: Record<string, string>; query?: string } = {},
) {
  const req = new Request(
    `http://localhost/api/webhooks/${provider}${opts.query ?? ""}`,
    {
      method: "POST",
      headers: opts.headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
  return POST(req, { params: { provider } });
}

const fetchMock = vi.fn(async () => new Response("ok"));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accounts.clear();
  mocks.tokens.clear();
  mocks.rejections.length = 0;
  vi.stubGlobal("fetch", fetchMock);
  // 이 파일의 SNS 봉투 픽스처는 서명이 없다 — 봉투 처리 자체를 검증하는
  // 테스트라 서명 검증은 끈다. 검증 동작은 webhook-verify.test.ts와 아래
  // "SNS 서명 검증" describe가 다룬다.
  vi.stubEnv("SNS_VERIFY", "false");
  mocks.ingestAlerts.mockImplementation(async (alerts: unknown[]) =>
    alerts.map((_, i) => ({ alertId: `a${i}`, created: true })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("routing basics", () => {
  it("404s on unknown providers", async () => {
    const res = await post("nagios", { title: "x" });
    expect(res.status).toBe(404);
  });

  it("400s on invalid JSON", async () => {
    const res = await post("alarm", "{not json");
    expect(res.status).toBe(400);
  });

  it("400s when a payload matches nothing", async () => {
    const res = await post("alarm", { foo: "bar" });
    expect(res.status).toBe(400);
  });

  it("413s on oversized bodies", async () => {
    const res = await post("generic", `{"title":"${"x".repeat(1_000_001)}"}`);
    expect(res.status).toBe(413);
  });

  it("ingests a generic alert and reports the provider used", async () => {
    const res = await post("alarm", { title: "disk full", severity: "SEV-3" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, provider: "generic", ingested: 1 });
    expect(mocks.ingestAlerts).toHaveBeenCalledOnce();
  });
});

describe("INGEST_TOKEN", () => {
  beforeEach(() => {
    vi.stubEnv("INGEST_TOKEN", "sekret");
  });

  it("rejects requests without the token", async () => {
    const res = await post("generic", { title: "x" });
    expect(res.status).toBe(401);
  });

  it("accepts the token via header", async () => {
    const res = await post("generic", { title: "x" }, {
      headers: { "x-webhook-token": "sekret" },
    });
    expect(res.status).toBe(200);
  });

  it("accepts the token via ?token= (SNS/PagerDuty cannot set headers)", async () => {
    const res = await post("generic", { title: "x" }, { query: "?token=sekret" });
    expect(res.status).toBe(200);
  });

  it("rejects a wrong token", async () => {
    const res = await post("generic", { title: "x" }, { query: "?token=nope" });
    expect(res.status).toBe(401);
  });
});

describe("SNS envelope", () => {
  it("confirms subscriptions by fetching a genuine SNS SubscribeURL", async () => {
    const url =
      "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc";
    const res = await post("cloudwatch", {
      Type: "SubscriptionConfirmation",
      TopicArn: "arn:aws:sns:us-east-1:123:t",
      SubscribeURL: url,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).confirmed).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(url);
  });

  it("refuses to fetch a non-SNS SubscribeURL (SSRF guard)", async () => {
    for (const evil of [
      "http://169.254.169.254/latest/meta-data/",
      "https://evil.example.com/sns.us-east-1.amazonaws.com",
      "https://sns.us-east-1.amazonaws.com.evil.example.com/x",
    ]) {
      const res = await post("cloudwatch", {
        Type: "SubscriptionConfirmation",
        TopicArn: "arn:aws:sns:us-east-1:123:t",
        SubscribeURL: evil,
      });
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("peels a Notification and ingests the inner CloudWatch alarm", async () => {
    const res = await post("cloudwatch", {
      Type: "Notification",
      TopicArn: "arn:aws:sns:us-east-1:123:t",
      Message: JSON.stringify({
        AlarmName: "SEV-2 api 5xx",
        NewStateValue: "ALARM",
        AlarmArn: "arn:aws:cloudwatch:us-east-1:123:alarm:api-5xx",
      }),
    });
    expect(res.status).toBe(200);
    const ingested = mocks.ingestAlerts.mock.calls[0][0];
    expect(ingested[0].fingerprint).toBe(
      "cw:arn:aws:cloudwatch:us-east-1:123:alarm:api-5xx",
    );
    expect(ingested[0].status).toBe("FIRING");
  });

  it("stores plain-text Notifications as generic alerts even on the cloudwatch route", async () => {
    const res = await post("cloudwatch", {
      Type: "Notification",
      TopicArn: "arn:aws:sns:us-east-1:123:t",
      Subject: "disk warning",
      Message: "disk usage at 91% on web-3",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).provider).toBe("generic");
    const ingested = mocks.ingestAlerts.mock.calls[0][0];
    expect(ingested[0].title).toBe("disk warning");
    expect(ingested[0].source).toBe("sns");
  });

  it("returns 200 for unparseable SNS payloads (no retry storm) and acks other types", async () => {
    const bad = await post("cloudwatch", {
      Type: "Notification",
      TopicArn: "arn:aws:sns:us-east-1:123:t",
      Message: 42,
    });
    expect(bad.status).toBe(200);

    const unsub = await post("cloudwatch", {
      Type: "UnsubscribeConfirmation",
      TopicArn: "arn:aws:sns:us-east-1:123:t",
    });
    expect(unsub.status).toBe(200);
    expect((await unsub.json()).ignored).toBe("UnsubscribeConfirmation");
  });
});

describe("SNS 서명 검증 (기본 켜짐)", () => {
  it("서명 없는 SNS 봉투는 401 — SubscribeURL fetch도 하지 않는다", async () => {
    vi.stubEnv("SNS_VERIFY", ""); // 기본값(켜짐)으로 복원
    const res = await post("cloudwatch", {
      Type: "SubscriptionConfirmation",
      TopicArn: "arn:aws:sns:us-east-1:123:t",
      SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=Confirm",
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid SNS signature");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.ingestAlerts).not.toHaveBeenCalled();
  });

  it("SigningCertURL이 SNS가 아니면 인증서를 fetch하지 않고 거절한다", async () => {
    vi.stubEnv("SNS_VERIFY", "");
    const res = await post("cloudwatch", {
      Type: "Notification",
      TopicArn: "arn:aws:sns:us-east-1:123:t",
      Message: "{}",
      MessageId: "m1",
      Timestamp: "2026-08-30T00:00:00Z",
      Signature: "aaaa",
      SignatureVersion: "1",
      SigningCertURL: "https://evil.example.com/cert.pem",
    });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PagerDuty HMAC (PAGERDUTY_WEBHOOK_SECRET 설정 시)", () => {
  const body = JSON.stringify({
    event: { id: "e1", event_type: "incident.triggered", data: { id: "i1", title: "t" } },
  });

  it("서명이 없거나 틀리면 401", async () => {
    vi.stubEnv("PAGERDUTY_WEBHOOK_SECRET", "pd-secret");
    const none = await post("pagerduty", body);
    expect(none.status).toBe(401);

    const wrong = await post("pagerduty", body, {
      headers: { "x-pagerduty-signature": "v1=deadbeef" },
    });
    expect(wrong.status).toBe(401);
  });

  it("올바른 v1 HMAC이면 통과한다 (로테이션 중 다중 서명 포함)", async () => {
    vi.stubEnv("PAGERDUTY_WEBHOOK_SECRET", "pd-secret");
    const { createHmac } = await import("node:crypto");
    const good = createHmac("sha256", "pd-secret").update(body).digest("hex");

    const res = await post("pagerduty", body, {
      headers: { "x-pagerduty-signature": `v1=deadbeef,v1=${good}` },
    });
    expect(res.status).toBe(200);
    expect(mocks.ingestAlerts).toHaveBeenCalledOnce();
  });

  it("비밀이 설정돼 있지 않으면 서명 검증은 하지 않는다 (토큰 계층은 별개)", async () => {
    const res = await post("pagerduty", body);
    expect(res.status).toBe(200);
  });
});

// ---- 누가 보냈는지 (수집 보안 1단계) ----
const HOMENIC = "771283576189";
const HOMENIC_DEV = "111122223333";
const OTHER = "444455556666";
function snsAlarm(topicAccount: string, alarmAccount: string, extra: Record<string, unknown> = {}) {
  return {
    Type: "Notification",
    TopicArn: `arn:aws:sns:ap-northeast-2:${topicAccount}:alert-hub`,
    Message: JSON.stringify({
      AlarmName: "CPU high",
      NewStateValue: "ALARM",
      AlarmArn: `arn:aws:cloudwatch:ap-northeast-2:${alarmAccount}:alarm:cpu`,
      ...extra,
    }),
  };
}

describe("수집 보안 — 남의 계정 ID 를 적어 보내는 위조", () => {
  beforeEach(() => {
    mocks.accounts.set(HOMENIC, "c_homenic").set(HOMENIC_DEV, "c_homenic").set(OTHER, "c_other");
  });

  it("주제 계정 = 알람 계정(등록됨) → 받는다", async () => {
    const res = await post("cloudwatch", snsAlarm(HOMENIC, HOMENIC));
    expect(res.status).toBe(200);
    expect(mocks.ingestAlerts.mock.calls[0][0]).toHaveLength(1);
  });

  it("같은 고객사의 다른 계정 주제로 모아 보내도 받는다 (교차 계정 SNS)", async () => {
    await post("cloudwatch", snsAlarm(HOMENIC_DEV, HOMENIC));
    expect(mocks.ingestAlerts.mock.calls[0][0]).toHaveLength(1);
  });

  it("모르는 계정 주제가 홈닉 계정 ID 를 적어 보내면 거부하고 기록", async () => {
    const res = await post("cloudwatch", snsAlarm("999999999999", HOMENIC));
    expect(res.status).toBe(200); // SNS 재시도 폭주 방지 — 200 이지만 받지 않는다
    expect(await res.json()).toMatchObject({ ingested: 0, rejected: 1 });
    expect(mocks.ingestAlerts.mock.calls[0][0]).toHaveLength(0);
    expect(mocks.rejections[0]).toMatchObject({ kind: "alert", accountId: HOMENIC });
  });

  it("다른 고객사 계정 주제가 홈닉 계정 ID 를 적어 보내도 거부", async () => {
    await post("cloudwatch", snsAlarm(OTHER, HOMENIC));
    expect(mocks.ingestAlerts.mock.calls[0][0]).toHaveLength(0);
  });

  it("등록 안 된 계정 알람은 미매핑으로 받는다 (새 계정 매핑 입구)", async () => {
    await post("cloudwatch", snsAlarm("999999999999", "999999999999"));
    expect(mocks.ingestAlerts.mock.calls[0][0]).toHaveLength(1);
  });
});

describe("고객사 전용 수집 주소", () => {
  beforeEach(() => {
    vi.stubEnv("INGEST_TOKEN", "global-secret");
    mocks.accounts.set(HOMENIC, "c_homenic").set(OTHER, "c_other");
    mocks.tokens.set("in_homenic", "c_homenic");
  });

  it("고객사 토큰으로도 인증된다 (공용 토큰 없이)", async () => {
    const res = await post("cloudwatch", snsAlarm(HOMENIC, HOMENIC), { query: "?token=in_homenic" });
    expect(res.status).toBe(200);
    expect(mocks.ingestAlerts.mock.calls[0][0]).toHaveLength(1);
  });

  it("홈닉 주소로 다른 고객사 계정 알람이 오면 거부", async () => {
    await post("cloudwatch", snsAlarm(OTHER, OTHER), { query: "?token=in_homenic" });
    expect(mocks.ingestAlerts.mock.calls[0][0]).toHaveLength(0);
    expect(mocks.rejections[0].reason).toContain("다른 고객사");
  });

  it("틀린 토큰은 401", async () => {
    expect((await post("cloudwatch", snsAlarm(HOMENIC, HOMENIC), { query: "?token=in_nope" })).status).toBe(401);
  });

  it("고객사 주소의 구독 확인은 그 고객사 계정 주제만", async () => {
    const sub = (acct: string) => ({
      Type: "SubscriptionConfirmation",
      TopicArn: `arn:aws:sns:ap-northeast-2:${acct}:alert-hub`,
      SubscribeURL: "https://sns.ap-northeast-2.amazonaws.com/?Action=ConfirmSubscription&Token=x",
    });
    expect((await post("cloudwatch", sub(OTHER), { query: "?token=in_homenic" })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await post("cloudwatch", sub(HOMENIC), { query: "?token=in_homenic" })).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

