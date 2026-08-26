import { describe, expect, it } from "vitest";
import {
  anyFilterActive,
  dashboardHref,
  matchesFilters,
  parseStatusParam,
  UNASSIGNED,
  type AlertFacts,
  type DashboardFilters,
} from "@/lib/alert-filters";

// 대시보드 필터 결합 규칙 (§6.1). AlertFacts는 페이지가 Alert + 해석 결과를
// 납작하게 만든 것 — 여기서는 조합 의미만 검증한다.

function facts(overrides: Partial<AlertFacts> = {}): AlertFacts {
  return {
    status: "FIRING",
    title: "SEV-1 prod-db CPU",
    resource: "prod-db",
    metric: "CPUUtilization",
    accountId: "123456789012",
    chain: { customerId: "cust1", projectId: "proj1", environment: "prd" },
    primary: { id: "c1", name: "최민서" },
    ...overrides,
  };
}

function filters(overrides: Partial<DashboardFilters> = {}): DashboardFilters {
  return { statuses: [], unmapped: false, ...overrides };
}

describe("parseStatusParam — 상태 칩 다중 토글의 CSV 형식", () => {
  it("CSV를 파싱하고 모르는 값·중복은 버린다", () => {
    expect(parseStatusParam("FIRING,ACKNOWLEDGED")).toEqual([
      "FIRING",
      "ACKNOWLEDGED",
    ]);
    expect(parseStatusParam("FIRING,BOGUS,FIRING")).toEqual(["FIRING"]);
    expect(parseStatusParam(undefined)).toEqual([]);
    expect(parseStatusParam("")).toEqual([]);
  });

  it("스탯 타일의 단일 status 링크(레거시 형식)도 그대로 통한다", () => {
    expect(parseStatusParam("RESOLVED")).toEqual(["RESOLVED"]);
  });
});

describe("matchesFilters", () => {
  it("빈 필터는 전부 통과", () => {
    expect(matchesFilters(facts(), filters())).toBe(true);
    expect(matchesFilters(facts({ chain: null, primary: null }), filters())).toBe(true);
  });

  it("상태 다중 토글: 집합 안이면 통과, 밖이면 제외", () => {
    const f = filters({ statuses: ["FIRING", "ACKNOWLEDGED"] });
    expect(matchesFilters(facts({ status: "ACKNOWLEDGED" }), f)).toBe(true);
    expect(matchesFilters(facts({ status: "RESOLVED" }), f)).toBe(false);
  });

  it("조직 필터는 살아있는 체인 기준 — 미매핑/계정 없음은 어느 고객사에도 안 잡힌다", () => {
    const f = filters({ customer: "cust1" });
    expect(matchesFilters(facts(), f)).toBe(true);
    expect(matchesFilters(facts({ chain: null }), f)).toBe(false);
    expect(
      matchesFilters(facts({ accountId: null, chain: null }), f),
    ).toBe(false);
    expect(
      matchesFilters(
        facts({ chain: { customerId: "cust2", projectId: "p", environment: null } }),
        f,
      ),
    ).toBe(false);
  });

  it("프로젝트·환경 필터도 체인에서 읽는다", () => {
    expect(matchesFilters(facts(), filters({ project: "proj1", env: "prd" }))).toBe(true);
    expect(matchesFilters(facts(), filters({ env: "stg" }))).toBe(false);
  });

  it("자유 검색은 대소문자 무시, 제목·리소스·메트릭·계정을 훑는다", () => {
    expect(matchesFilters(facts(), filters({ q: "cpuutil" }))).toBe(true);
    expect(matchesFilters(facts(), filters({ q: "PROD-DB" }))).toBe(true);
    expect(matchesFilters(facts(), filters({ q: "1234567890" }))).toBe(true);
    expect(matchesFilters(facts(), filters({ q: "memory" }))).toBe(false);
  });

  it("담당 토글: 1순위가 그 사람일 때만, UNASSIGNED는 미지정만", () => {
    expect(matchesFilters(facts(), filters({ assignee: "c1" }))).toBe(true);
    expect(matchesFilters(facts(), filters({ assignee: "c2" }))).toBe(false);
    expect(matchesFilters(facts({ primary: null }), filters({ assignee: UNASSIGNED }))).toBe(true);
    expect(matchesFilters(facts(), filters({ assignee: UNASSIGNED }))).toBe(false);
  });

  it("미매핑 토글: 계정은 있는데 체인이 없는 알람만", () => {
    const f = filters({ unmapped: true });
    expect(matchesFilters(facts({ chain: null }), f)).toBe(true);
    expect(matchesFilters(facts(), f)).toBe(false);
    // 계정 정보 자체가 없는 알람은 '미매핑'이 아니라 별개 상태
    expect(matchesFilters(facts({ accountId: null, chain: null }), f)).toBe(false);
  });

  it("필터는 AND로 결합된다", () => {
    const f = filters({ customer: "cust1", statuses: ["FIRING"], q: "cpu" });
    expect(matchesFilters(facts(), f)).toBe(true);
    expect(matchesFilters(facts({ status: "RESOLVED" }), f)).toBe(false);
  });
});

describe("dashboardHref / anyFilterActive", () => {
  it("활성 필터만 쿼리에 남고, 비면 /", () => {
    expect(dashboardHref(filters())).toBe("/");
    const href = dashboardHref(
      filters({ customer: "cust1", statuses: ["FIRING", "RESOLVED"], q: "cpu" }),
    );
    const params = new URLSearchParams(href.slice(2));
    expect(params.get("customer")).toBe("cust1");
    expect(params.get("status")).toBe("FIRING,RESOLVED");
    expect(params.get("q")).toBe("cpu");
  });

  it("초기화 버튼 노출 조건", () => {
    expect(anyFilterActive(filters())).toBe(false);
    expect(anyFilterActive(filters({ q: "x" }))).toBe(true);
    expect(anyFilterActive(filters({ unmapped: true }))).toBe(true);
    expect(anyFilterActive(filters({ statuses: ["FIRING"] }))).toBe(true);
  });
});
