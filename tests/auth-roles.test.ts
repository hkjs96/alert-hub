import { describe, expect, it } from "vitest";
import { atLeast, isRole, ROLE_LABELS } from "@/lib/auth/roles";
import { newRef } from "@/lib/auth/ref";
import { AUTH_ERRORS } from "@/components/auth/error-card";

describe("역할 서열", () => {
  it("ADMIN ≥ OPERATOR ≥ VIEWER", () => {
    expect(atLeast("ADMIN", "OPERATOR")).toBe(true);
    expect(atLeast("OPERATOR", "ADMIN")).toBe(false);
    expect(atLeast("VIEWER", "VIEWER")).toBe(true);
    expect(atLeast("VIEWER", "OPERATOR")).toBe(false);
  });
  it("문자열 판정과 라벨", () => {
    expect(isRole("ADMIN")).toBe(true);
    expect(isRole("root")).toBe(false);
    expect(ROLE_LABELS.OPERATOR).toBe("온콜 엔지니어");
  });
});

describe("참조 코드", () => {
  it("접두사-5자리 16진, 매번 다르다", () => {
    const a = newRef("AU");
    expect(a).toMatch(/^AU-[0-9A-F]{5}$/);
    expect(newRef("RQ")).toMatch(/^RQ-[0-9A-F]{5}$/);
    expect(newRef("AU")).not.toBe(a);
  });
});

describe("로그인 오류 문구", () => {
  it("모든 콜백 오류 코드에 사용자 언어 카드가 있고 내부 단계명이 없다", () => {
    for (const code of ["domain", "customer", "inactive", "rejected", "state", "denied", "exchange", "claims"]) {
      const e = AUTH_ERRORS[code];
      expect(e, code).toBeDefined();
      const text = `${e.title} ${e.body}`.toLowerCase();
      for (const banned of ["state", "claims", "exchange", "nonce", "oauth", "token"]) {
        expect(text, `${code} contains ${banned}`).not.toContain(banned);
      }
      expect(e.primary.href.startsWith("/")).toBe(true);
    }
  });
});
