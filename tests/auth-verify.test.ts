import { describe, expect, it } from "vitest";
import { channelState, checkCode, generateCode, hashCode } from "@/lib/auth/verify";

describe("통지 채널 확인 코드", () => {
  it("6자리 숫자, 해시는 소금에 따라 다르다", async () => {
    const c = generateCode();
    expect(c).toMatch(/^\d{6}$/);
    expect(await hashCode(c, "a")).not.toBe(await hashCode(c, "b"));
  });
  it("맞는 코드·채널·기한이면 통과, 하나라도 틀리면 거부", async () => {
    const hash = await hashCode("123456", "c1");
    const future = new Date(Date.now() + 60_000);
    const base = { hash, salt: "c1", expiresAt: future, channel: "slack", expectedChannel: "slack" };
    expect(await checkCode({ ...base, input: "123456" })).toBe(true);
    expect(await checkCode({ ...base, input: " 123456 " })).toBe(true);
    expect(await checkCode({ ...base, input: "654321" })).toBe(false);
    expect(await checkCode({ ...base, input: "123456", expectedChannel: "email" })).toBe(false);
    expect(await checkCode({ ...base, input: "123456", expiresAt: new Date(Date.now() - 1) })).toBe(false);
    expect(await checkCode({ ...base, input: "123456", hash: null })).toBe(false);
    expect(await checkCode({ ...base, input: "12345" })).toBe(false);
  });
  it("채널 상태: 미등록 / 확인 필요 / 확인됨", () => {
    expect(channelState(null, null)).toBe("unregistered");
    expect(channelState("U1", null)).toBe("unverified");
    expect(channelState("U1", new Date())).toBe("verified");
  });
});
