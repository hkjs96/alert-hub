import { describe, expect, it } from "vitest";
import { alertWhere, canSeeCustomer, customerOfAssignment, scopeFromAssignments, ALL } from "@/lib/scope";

// 테넌트 스코프: 배정이 걸린 고객사만 본다. 어느 레벨에 배정돼도 고객사로 올라간다.

const row = (o: Partial<Parameters<typeof customerOfAssignment>[0]>) => ({
  customerId: null, project: null, service: null, account: null, ...o,
});

describe("배정 → 고객사", () => {
  it("고객사·프로젝트·서비스·계정 어느 레벨이든 고객사 id 로", () => {
    expect(customerOfAssignment(row({ customerId: "c1" }))).toBe("c1");
    expect(customerOfAssignment(row({ project: { customerId: "c2" } }))).toBe("c2");
    expect(customerOfAssignment(row({ service: { project: { customerId: "c3" } } }))).toBe("c3");
    expect(customerOfAssignment(row({ account: { service: { project: { customerId: "c4" } } } }))).toBe("c4");
    expect(customerOfAssignment(row({}))).toBeNull();
  });
  it("중복 제거·정렬, 배정 없으면 빈 스코프", () => {
    expect(scopeFromAssignments([row({ customerId: "b" }), row({ project: { customerId: "a" } }), row({ customerId: "b" })])).toEqual({ all: false, customerIds: ["a", "b"] });
    expect(scopeFromAssignments([])).toEqual({ all: false, customerIds: [] });
  });
});

describe("판정·where", () => {
  it("전체 스코프는 미매핑(null)도 본다, 제한 스코프는 목록 안만", () => {
    expect(canSeeCustomer(ALL, null)).toBe(true);
    const s = { all: false as const, customerIds: ["a"] };
    expect(canSeeCustomer(s, "a")).toBe(true);
    expect(canSeeCustomer(s, "b")).toBe(false);
    expect(canSeeCustomer(s, null)).toBe(false);
  });
  it("Prisma where 조각", () => {
    expect(alertWhere(ALL)).toEqual({});
    expect(alertWhere({ all: false, customerIds: ["a", "b"] })).toEqual({ customerId: { in: ["a", "b"] } });
    expect(alertWhere({ all: false, customerIds: [] })).toEqual({ customerId: { in: [] } });
  });
});
