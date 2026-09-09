import { beforeEach, describe, expect, it, vi } from "vitest";
import { signSlackRequest } from "@/lib/slack/verify";

// Slack 버튼 → 알람 전이. 서명 검증, 사람 매칭(Slack ID → 인원), 권한, 전이,
// 누른 메시지 교체(response_url) + 나머지 메시지 동기화.

const mocks = vi.hoisted(() => ({
  contactFindFirst: vi.fn(),
  alertFindUnique: vi.fn(),
  alertUpdateMany: vi.fn(),
  eventCreate: vi.fn(),
  silenceCreate: vi.fn(),
  slackFindMany: vi.fn(),
  slackCreate: vi.fn(),
  respond: vi.fn(),
  updateMessage: vi.fn(),
  postThread: vi.fn(),
  userDisplayName: vi.fn(),
  resolutionUpdate: vi.fn(),
  resolutionCreate: vi.fn(),
  eventFindFirst: vi.fn(),
  silenceCount: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findFirst: mocks.contactFindFirst },
    alert: { findUnique: mocks.alertFindUnique, updateMany: mocks.alertUpdateMany },
    alertEvent: { create: mocks.eventCreate, findFirst: mocks.eventFindFirst },
    silence: { create: mocks.silenceCreate, count: mocks.silenceCount },
    slackMessage: { findMany: mocks.slackFindMany, create: mocks.slackCreate },
    resolution: { update: mocks.resolutionUpdate, create: mocks.resolutionCreate },
  },
}));
vi.mock("@/lib/notify/slack-api", () => ({
  isBotConfigured: () => true,
  respondToInteraction: mocks.respond,
  updateMessage: mocks.updateMessage,
  postThread: mocks.postThread,
  userDisplayName: mocks.userDisplayName,
}));

import { POST } from "@/app/api/slack/interactive/route";

const secret = "test-signing-secret";
process.env.SLACK_SIGNING_SECRET = secret;

function request(payload: object, opts: { sign?: boolean; ts?: string } = {}) {
  const body = "payload=" + encodeURIComponent(JSON.stringify(payload));
  const ts = opts.ts ?? String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (opts.sign !== false) {
    headers["x-slack-request-timestamp"] = ts;
    headers["x-slack-signature"] = signSlackRequest(secret, ts, body);
  }
  return new Request("http://localhost/api/slack/interactive", { method: "POST", headers, body });
}
const click = (action: string, extra: object = {}) => ({
  type: "block_actions",
  user: { id: "U07", name: "kim" },
  container: { channel_id: "C1", message_ts: "1.1" },
  message: { text: "*CPU high*" },
  response_url: "https://hooks.slack.com/actions/x",
  actions: [{ action_id: action, value: "a1", block_id: "ah:a1" }],
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.contactFindFirst.mockResolvedValue({ id: "c1", name: "김도윤", role: "OPERATOR" });
  mocks.alertFindUnique.mockResolvedValue({ id: "a1", status: "FIRING" });
  mocks.alertUpdateMany.mockResolvedValue({ count: 1 });
  mocks.alertFindUnique.mockImplementation(async ({ select }: any) =>
    select?.ownershipSnapshot !== undefined
      ? { id: "a1", title: "CPU high", namespace: null, metric: "CPU", resource: "db", ackedBy: "김도윤", escalationStep: 1, ownershipSnapshot: null, firstSeenAt: new Date("2026-09-08T00:00:00Z") }
      : { id: "a1", status: "FIRING" },
  );
  mocks.eventFindFirst.mockResolvedValue({ createdAt: new Date("2026-09-08T00:00:00Z") });
  mocks.silenceCount.mockResolvedValue(0);
  mocks.resolutionCreate.mockResolvedValue({ id: "r1" });
  mocks.resolutionUpdate.mockResolvedValue({});
  mocks.eventCreate.mockResolvedValue({});
  mocks.silenceCreate.mockResolvedValue({});
  mocks.slackFindMany.mockResolvedValue([
    { channel: "C1", ts: "1.1", text: "*CPU high*" },
    { channel: "D9", ts: "2.2", text: "*CPU high*" },
  ]);
  mocks.respond.mockResolvedValue(undefined);
  mocks.updateMessage.mockResolvedValue(undefined);
  mocks.postThread.mockResolvedValue(undefined);
});

describe("서명·설정", () => {
  it("서명이 없거나 틀리면 401", async () => {
    expect((await POST(request(click("ah_ack"), { sign: false }))).status).toBe(401);
    expect(mocks.alertUpdateMany).not.toHaveBeenCalled();
  });
  it("시크릿 미설정이면 503", async () => {
    const saved = process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_SIGNING_SECRET;
    expect((await POST(request(click("ah_ack")))).status).toBe(503);
    process.env.SLACK_SIGNING_SECRET = saved;
  });
});

describe("Ack 버튼", () => {
  it("매칭된 운영자가 누르면 FIRING→ACKNOWLEDGED, 이벤트·메시지 교체·다른 메시지 동기화·스레드", async () => {
    const res = await POST(request(click("ah_ack")));
    expect(res.status).toBe(200);
    expect(mocks.alertUpdateMany.mock.calls[0][0]).toEqual({
      where: { id: "a1", status: { in: ["FIRING"] } },
      data: { status: "ACKNOWLEDGED", ackedBy: "김도윤" },
    });
    expect(mocks.eventCreate.mock.calls[0][0].data.stateReason).toBe("Ack (Slack 버튼) · 김도윤");
    // 누른 메시지: response_url 로 교체 (확인 버튼 사라짐)
    const replaced = mocks.respond.mock.calls[0][1];
    expect(replaced.replace_original).toBe(true);
    const actions = replaced.blocks.find((b: any) => b.type === "actions").elements.map((e: any) => e.action_id);
    expect(actions).toEqual(["ah_resolve", "ah_mute"]);
    // 다른 메시지(D9)만 chat.update, 누른 메시지(C1)는 건너뜀
    expect(mocks.updateMessage.mock.calls.map((c) => c[0])).toEqual([{ channel: "D9", ts: "2.2" }]);
    // 스레드는 둘 다
    expect(mocks.postThread.mock.calls.map((c) => [c[0].channel, c[1]])).toEqual([
      ["D9", "✓ 김도윤 님이 확인했습니다 (Slack)"],
      ["C1", "✓ 김도윤 님이 확인했습니다 (Slack)"],
    ]);
  });

  it("이미 확인된 알람이면 본인에게만 안내하고 바꾸지 않는다", async () => {
    mocks.alertFindUnique.mockResolvedValue({ id: "a1", status: "ACKNOWLEDGED" });
    await POST(request(click("ah_ack")));
    expect(mocks.alertUpdateMany).not.toHaveBeenCalled();
    expect(mocks.respond.mock.calls[0][1]).toMatchObject({ response_type: "ephemeral" });
    expect(mocks.respond.mock.calls[0][1].text).toContain("이미");
  });

  it("연결된 인원이 없으면 안내만", async () => {
    mocks.contactFindFirst.mockResolvedValue(null);
    await POST(request(click("ah_ack")));
    expect(mocks.alertUpdateMany).not.toHaveBeenCalled();
    expect(mocks.respond.mock.calls[0][1].text).toContain("연결된 Slack 계정이 아닙니다");
  });

  it("조회 권한은 거절", async () => {
    mocks.contactFindFirst.mockResolvedValue({ id: "c2", name: "조회자", role: "VIEWER" });
    await POST(request(click("ah_ack")));
    expect(mocks.alertUpdateMany).not.toHaveBeenCalled();
    expect(mocks.respond.mock.calls[0][1].text).toContain("조회 권한");
  });
});

describe("Resolve · 뮤트", () => {
  it("Resolve 는 ACKNOWLEDGED 에서도 되고, 해결 기록을 남기며 스레드에 분류 버튼이 붙는다", async () => {
    mocks.alertFindUnique.mockImplementation(async ({ select }: any) =>
      select?.ownershipSnapshot !== undefined
        ? { id: "a1", title: "CPU high", namespace: null, metric: "CPU", resource: "db", ackedBy: "김도윤", escalationStep: 1, ownershipSnapshot: null, firstSeenAt: new Date("2026-09-08T00:00:00Z") }
        : { id: "a1", status: "ACKNOWLEDGED" },
    );
    await POST(request(click("ah_resolve")));
    expect(mocks.alertUpdateMany.mock.calls[0][0].where).toEqual({ id: "a1", status: { in: ["FIRING", "ACKNOWLEDGED"] } });
    const actions = mocks.respond.mock.calls[0][1].blocks.find((b: any) => b.type === "actions");
    expect(actions).toBeUndefined(); // RESOLVED 엔 버튼 없음 (APP_URL 없음)
    // 해결 기록: 사람이 닫음
    expect(mocks.resolutionCreate.mock.calls[0][0].data).toMatchObject({ alertId: "a1", via: "manual", resolvedBy: "김도윤", kind: null });
    // 누른 메시지 스레드: 분류 버튼 4개 (value = resolutionId:kind)
    const here = mocks.postThread.mock.calls.find((c) => c[0].channel === "C1");
    const kinds = here![3].find((b: any) => b.type === "actions").elements.map((e: any) => e.value);
    expect(kinds).toEqual(["r1:restart", "r1:config", "r1:auto", "r1:other"]);
  });

  it("분류 버튼을 누르면 기록만 갱신하고 메시지를 '기록됨' 으로 바꾼다", async () => {
    await POST(request(click("ah_kind:restart", { actions: [{ action_id: "ah_kind:restart", value: "r1:restart" }] })));
    expect(mocks.resolutionUpdate.mock.calls[0][0]).toEqual({ where: { id: "r1" }, data: { kind: "restart", kindBy: "김도윤" } });
    expect(mocks.alertUpdateMany).not.toHaveBeenCalled();
    expect(mocks.respond.mock.calls[0][1]).toEqual({ replace_original: true, text: "✓ 재시작 으로 기록 · 김도윤" });
  });

  it("뮤트는 이 알람 1시간 Silence 를 만들고 상태는 그대로", async () => {
    await POST(request(click("ah_mute")));
    const data = mocks.silenceCreate.mock.calls[0][0].data;
    expect(data.alertId).toBe("a1");
    expect(data.endsAt.getTime() - data.startsAt.getTime()).toBe(60 * 60 * 1000);
    expect(data.reason).toContain("김도윤");
    expect(mocks.alertUpdateMany).not.toHaveBeenCalled();
    const ctx = mocks.respond.mock.calls[0][1].blocks.find((b: any) => b.type === "context").elements[0].text;
    expect(ctx).toContain("🔇 1시간 뮤트");
    expect(mocks.postThread.mock.calls[0][1]).toContain("뮤트");
  });
});
