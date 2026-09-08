import { describe, expect, it } from "vitest";
import { buildAlertBlocks, threadLine } from "@/lib/notify/slack-blocks";

// Slack 봇 메시지: 본문은 그대로, 상태에 맞는 버튼만. RESOLVED 엔 버튼 없음.

const ids = (blocks: any[]) =>
  (blocks.find((b) => b.type === "actions")?.elements ?? []).map((e: any) => e.action_id);
const ctx = (blocks: any[]) => blocks.find((b) => b.type === "context")?.elements?.[0]?.text ?? null;

describe("buildAlertBlocks", () => {
  it("FIRING: 확인·해결·뮤트 + 열기 링크", () => {
    const b = buildAlertBlocks("*CPU high*", { alertId: "a1", status: "FIRING", appUrl: "https://hub.example/" });
    expect(b[0]).toEqual({ type: "section", text: { type: "mrkdwn", text: "*CPU high*" } });
    expect(ids(b)).toEqual(["ah_ack", "ah_resolve", "ah_mute", "ah_open"]);
    const open = (b.find((x: any) => x.type === "actions") as any).elements.at(-1);
    expect(open.url).toBe("https://hub.example/alerts/a1");
    expect(ctx(b)).toBeNull();
  });
  it("ACKNOWLEDGED: 확인 버튼이 빠지고 상태 줄이 붙는다", () => {
    const b = buildAlertBlocks("t", { alertId: "a1", status: "ACKNOWLEDGED", note: "김도윤 · Slack · 16:20" });
    expect(ids(b)).toEqual(["ah_resolve", "ah_mute"]);
    expect(ctx(b)).toBe("✓ 확인됨 · 김도윤 · Slack · 16:20");
  });
  it("RESOLVED: 버튼 없음 (열기 링크만)", () => {
    const b = buildAlertBlocks("t", { alertId: "a1", status: "RESOLVED", note: "cloudwatch", appUrl: "https://h" });
    expect(ids(b)).toEqual(["ah_open"]);
    expect(ctx(b)).toBe("● 해결됨 · cloudwatch");
  });
  it("뮤트 중이면 뮤트 버튼이 빠지고 안내가 붙는다", () => {
    const b = buildAlertBlocks("t", { alertId: "a1", status: "FIRING", muted: "1시간 뮤트 · 김도윤" });
    expect(ids(b)).toEqual(["ah_ack", "ah_resolve"]);
    expect(ctx(b)).toBe("🔇 1시간 뮤트 · 김도윤");
  });
  it("스레드 한 줄", () => {
    expect(threadLine("ACKNOWLEDGED", "김도윤", "Slack")).toBe("✓ 김도윤 님이 확인했습니다 (Slack)");
    expect(threadLine("RESOLVED", null, "cloudwatch OK")).toBe("● 해결됨 (cloudwatch OK)");
    expect(threadLine("MUTED", "이서연", "Slack")).toBe("🔇 이서연 님이 1시간 뮤트했습니다 (Slack)");
  });
});
