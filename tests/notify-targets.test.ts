import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeTarget, isWebhookUrl, normalizeBotChannel, resolveTargets } from "@/lib/notify/targets";

describe("통지 채널 상속", () => {
  const c = { kind: "SLACK_BOT" as const, target: "#cust" };
  const p = { kind: "SLACK_WEBHOOK" as const, target: "https://hooks.slack.com/services/T1/B1/x" };
  const s = { kind: "SLACK_BOT" as const, target: "#svc" };
  it("가장 구체적인 스코프에 하나라도 있으면 그 목록만", () => {
    expect(resolveTargets({ service: [s], project: [p], customer: [c] }).map((t) => t.target)).toEqual(["#svc"]);
    expect(resolveTargets({ service: [], project: [p], customer: [c] }).map((t) => t.level)).toEqual(["project"]);
    expect(resolveTargets({ service: [], project: [], customer: [c, s] })).toHaveLength(2);
    expect(resolveTargets({ service: [], project: [], customer: [] })).toEqual([]);
  });
  it("입력 정규화·검증", () => {
    expect(normalizeBotChannel("homenic-alerts")).toBe("#homenic-alerts");
    expect(normalizeBotChannel("#x")).toBe("#x");
    expect(normalizeBotChannel("C0123ABCDEF")).toBe("C0123ABCDEF");
    expect(isWebhookUrl("https://hooks.slack.com/services/T1/B1/abc")).toBe(true);
    expect(isWebhookUrl("https://evil.example/hook")).toBe(false);
    expect(describeTarget(p)).toBe("외부 웹훅 (T1)");
    expect(describeTarget(c)).toBe("#cust");
  });
});

describe("sendSlackText 목적지 분기", () => {
  const calls: { url: string; body: string; auth?: string }[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? ""), auth: (init?.headers as Record<string, string>)?.authorization });
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ ok: true, channel: { id: "D1" } }) } as Response;
    }));
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_DEFAULT_CHANNEL;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("스코프 채널이 있으면 그 목적지 전부로, 없으면 전사 기본으로", async () => {
    const { sendSlackText } = await import("@/lib/notify/slack");
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T0/B0/global";
    const r = await sendSlackText("hi", [
      { kind: "SLACK_BOT", target: "#svc" },
      { kind: "SLACK_WEBHOOK", target: "https://hooks.slack.com/services/T9/B9/cust" },
    ]);
    expect(r).toBe("sent");
    expect(calls.map((c) => c.url)).toEqual(["https://slack.com/api/chat.postMessage", "https://hooks.slack.com/services/T9/B9/cust"]);
    expect(JSON.parse(calls[0].body)).toMatchObject({ channel: "#svc", text: "hi" });
    expect(calls[0].auth).toBe("Bearer xoxb-test");

    calls.length = 0;
    await sendSlackText("fallback");
    expect(calls.map((c) => c.url)).toEqual(["https://hooks.slack.com/services/T0/B0/global"]);
  });

  it("봇 토큰이 없으면 봇 채널은 건너뛰고 웹훅만 나간다 · 둘 다 없으면 skipped", async () => {
    const { sendSlackText } = await import("@/lib/notify/slack");
    const r = await sendSlackText("x", [
      { kind: "SLACK_BOT", target: "#svc" },
      { kind: "SLACK_WEBHOOK", target: "https://hooks.slack.com/services/T9/B9/cust" },
    ]);
    expect(r).toBe("sent");
    expect(calls).toHaveLength(1);
    expect(await sendSlackText("nothing")).toBe("skipped");
  });

  it("한 목적지가 실패해도 나머지는 나가고, 전부 실패해야 throw", async () => {
    const { sendSlackText } = await import("@/lib/notify/slack");
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (String(url).includes("/bad/")) return { ok: false, status: 500, statusText: "boom", json: async () => ({}) } as Response;
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ ok: true }) } as Response;
    });
    const r = await sendSlackText("x", [
      { kind: "SLACK_WEBHOOK", target: "https://hooks.slack.com/services/T9/bad/1" },
      { kind: "SLACK_WEBHOOK", target: "https://hooks.slack.com/services/T9/B9/ok" },
    ]);
    expect(r).toBe("sent");
    await expect(sendSlackText("x", [{ kind: "SLACK_WEBHOOK", target: "https://hooks.slack.com/services/T9/bad/2" }])).rejects.toThrow();
  });
});
