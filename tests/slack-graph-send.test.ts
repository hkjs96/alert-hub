import { beforeEach, describe, expect, it, vi } from "vitest";

// Slack 이 그래프 이미지를 못 가져오면 메시지 전체가 거절된다 — 그래프만 빼고 알람은 보낸다.
// 그리고 상태 동기화는 이번 발화 메시지만 건드린다(지난 발화 스레드에 글이 달리지 않게).

const m = vi.hoisted(() => ({
  postMessage: vi.fn(),
  record: vi.fn(),
  eventFindFirst: vi.fn(),
  msgFindMany: vi.fn(),
}));
vi.mock("@/lib/notify/slack-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify/slack-api")>()),
  isBotConfigured: () => true,
  postMessage: m.postMessage,
}));
vi.mock("@/lib/notify/slack-refs", () => ({ recordSlackRef: m.record, setSlackRefRecorder: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { alertEvent: { findFirst: m.eventFindFirst }, slackMessage: { findMany: m.msgFindMany, create: vi.fn() } },
}));

import { sendToTarget } from "@/lib/notify/slack";
import { currentFiringMessages } from "@/server/slack-sync";

const body = [
  { type: "header", text: { type: "plain_text", text: "x" } },
  { type: "image", block_id: "ah_graph", image_url: "https://hub.example/api/g/a1.png", alt_text: "g" },
];

beforeEach(() => vi.clearAllMocks());

describe("그래프 이미지 실패 시 알람은 그래도 나간다", () => {
  it("첫 발송이 거절되면 그래프 블록만 빼고 다시 보내고, 뺀 본문을 기록", async () => {
    m.postMessage.mockRejectedValueOnce(new Error("slack chat.postMessage: invalid_blocks")).mockResolvedValueOnce({ channel: "C1", ts: "1.1" });
    expect(await sendToTarget({ kind: "SLACK_BOT", target: "#a" }, "t", "a1", body)).toBe("sent");
    const second = m.postMessage.mock.calls[1][3] as { type: string }[];
    expect(second.some((b) => b.type === "image")).toBe(false);
    expect(second.some((b) => b.type === "actions")).toBe(true);
    expect(m.record).toHaveBeenCalledWith("a1", { channel: "C1", ts: "1.1" }, "t", [body[0]]);
  });
  it("그래프가 없는 메시지의 실패는 그대로 실패", async () => {
    m.postMessage.mockRejectedValue(new Error("channel_not_found"));
    await expect(sendToTarget({ kind: "SLACK_BOT", target: "#a" }, "t", "a1", [body[0]])).rejects.toThrow("channel_not_found");
  });
});

describe("상태 동기화 대상 = 이번 발화 메시지만", () => {
  it("마지막 FIRING 시각(5초 여유) 이후 메시지만 고른다", async () => {
    m.eventFindFirst.mockResolvedValue({ createdAt: new Date("2026-11-04T01:00:00Z") });
    m.msgFindMany.mockResolvedValue([]);
    await currentFiringMessages("a1");
    expect(m.msgFindMany).toHaveBeenCalledWith({
      where: { alertId: "a1", createdAt: { gte: new Date("2026-11-04T00:59:55Z") } },
      orderBy: { createdAt: "asc" },
    });
  });
});
