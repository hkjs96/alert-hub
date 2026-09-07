import { describe, expect, it } from "vitest";
import { isE164, normalizePhone } from "@/lib/phone";
import { newLinkToken, isVerifyChannel, viaLabel } from "@/lib/auth/verify";

describe("전화번호 정규화", () => {
  it("한국 번호 표기를 전부 +82로", () => {
    expect(normalizePhone("01072701323")).toBe("+821072701323");
    expect(normalizePhone("010-7270-1323")).toBe("+821072701323");
    expect(normalizePhone("+82 10 7270 1323")).toBe("+821072701323");
    expect(normalizePhone("82-10-7270-1323")).toBe("+821072701323");
    expect(normalizePhone("0082 10 7270 1323")).toBe("+821072701323");
    expect(normalizePhone("+14155550100")).toBe("+14155550100");
    expect(normalizePhone("  ")).toBeNull();
    expect(isE164("+821072701323")).toBe(true);
    expect(isE164("01072701323")).toBe(false);
  });
});

describe("확인 링크 토큰", () => {
  it("URL-safe, 매번 다름", () => {
    const a = newLinkToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(newLinkToken()).not.toBe(a);
    expect(isVerifyChannel("sms")).toBe(true);
    expect(isVerifyChannel("fax")).toBe(false);
    expect(viaLabel("admin:김도윤")).toBe("관리자 수동 (김도윤)");
  });
});
