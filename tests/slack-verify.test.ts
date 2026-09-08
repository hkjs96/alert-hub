import { describe, expect, it } from "vitest";
import { parseInteractionBody, signSlackRequest, verifySlackSignature } from "@/lib/slack/verify";

const secret = "8f742231b10e8888abcd99yyyzzz85a5";
const now = new Date("2026-09-08T07:00:00Z");
const ts = String(Math.floor(now.getTime() / 1000));
const body = "payload=%7B%22type%22%3A%22block_actions%22%7D";

describe("Slack 서명", () => {
  it("올바른 서명은 통과, 바뀐 본문·시크릿은 거부", () => {
    const sig = signSlackRequest(secret, ts, body);
    expect(verifySlackSignature(secret, ts, body, sig, now)).toBe(true);
    expect(verifySlackSignature(secret, ts, body + "x", sig, now)).toBe(false);
    expect(verifySlackSignature("other", ts, body, sig, now)).toBe(false);
    expect(verifySlackSignature(secret, ts, body, "v0=00", now)).toBe(false);
    expect(verifySlackSignature(secret, ts, body, null, now)).toBe(false);
  });
  it("5분 넘은 타임스탬프는 재전송으로 보고 거부", () => {
    const old = String(Math.floor(now.getTime() / 1000) - 6 * 60);
    expect(verifySlackSignature(secret, old, body, signSlackRequest(secret, old, body), now)).toBe(false);
  });
});

describe("인터랙션 페이로드", () => {
  it("block_actions 만 받는다", () => {
    const p = { type: "block_actions", user: { id: "U1" }, actions: [{ action_id: "ah_ack", value: "a1" }] };
    const parsed = parseInteractionBody("payload=" + encodeURIComponent(JSON.stringify(p)));
    expect(parsed?.actions[0].value).toBe("a1");
    expect(parseInteractionBody("payload=" + encodeURIComponent(JSON.stringify({ type: "view_submission" })))).toBeNull();
    expect(parseInteractionBody("garbage")).toBeNull();
  });
});
