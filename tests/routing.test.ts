import { describe, expect, it } from "vitest";
import { describeConditions, globMatch, matchRoutingRule, severityMatch, type RoutingRuleLite } from "@/lib/routing";

// Phase 3: 트리 순서를 알람 속성으로 덮어쓰는 규칙. "RDS는 DB팀", "CRITICAL은
// 야간 당직" 같은 기능 축 온콜.

const rule = (o: Partial<RoutingRuleLite> & { id: string; teamId: string }): RoutingRuleLite => ({
  name: o.id,
  priority: 100,
  enabled: true,
  namespace: null,
  metric: null,
  severity: null,
  resource: null,
  serviceId: null,
  ...o,
});

describe("글롭·severity 매치", () => {
  it("빈 패턴은 전부, * 는 접두/접미/중간, 대소문자 무시", () => {
    expect(globMatch(null, "AWS/RDS")).toBe(true);
    expect(globMatch("*", null)).toBe(true);
    expect(globMatch("AWS/RDS", "aws/rds")).toBe(true);
    expect(globMatch("AWS/*", "AWS/RDS")).toBe(true);
    expect(globMatch("*rds*", "AWS/RDS")).toBe(true);
    expect(globMatch("prod-db-*", "prod-db-01")).toBe(true);
    expect(globMatch("prod-db-*", "stage-db-01")).toBe(false);
    expect(globMatch("AWS/RDS", null)).toBe(false);
    // 정규식 메타문자는 리터럴
    expect(globMatch("a.b", "axb")).toBe(false);
  });
  it("severity는 쉼표 목록 정확 일치", () => {
    expect(severityMatch("CRITICAL, sev-1", "SEV-1")).toBe(true);
    expect(severityMatch("CRITICAL", "WARNING")).toBe(false);
    expect(severityMatch("", "WARNING")).toBe(true);
    expect(severityMatch("CRITICAL", null)).toBe(false);
  });
});

describe("규칙 선택", () => {
  it("RDS 네임스페이스면 DB팀, 아니면 규칙 없음(트리 순서 유지)", () => {
    const rules = [rule({ id: "rds", teamId: "db", namespace: "AWS/RDS" })];
    expect(matchRoutingRule(rules, { namespace: "AWS/RDS", severity: "WARNING" })?.teamId).toBe("db");
    expect(matchRoutingRule(rules, { namespace: "AWS/ELB", severity: "WARNING" })).toBeNull();
  });
  it("priority 낮은 규칙이 먼저, 같으면 만든 순", () => {
    const rules = [
      rule({ id: "catch-all", teamId: "night", priority: 900 }),
      rule({ id: "crit", teamId: "sre", priority: 10, severity: "CRITICAL" }),
      rule({ id: "crit-later", teamId: "other", priority: 10, severity: "CRITICAL" }),
    ];
    expect(matchRoutingRule(rules, { severity: "CRITICAL" })?.id).toBe("crit");
    expect(matchRoutingRule(rules, { severity: "WARNING" })?.id).toBe("catch-all");
  });
  it("비활성 규칙은 건너뛰고, serviceId 제한은 그 서비스에서만", () => {
    const rules = [
      rule({ id: "off", teamId: "x", enabled: false }),
      rule({ id: "svc", teamId: "pay", serviceId: "s1" }),
    ];
    expect(matchRoutingRule(rules, { serviceId: "s1" })?.id).toBe("svc");
    expect(matchRoutingRule(rules, { serviceId: "s2" })).toBeNull();
  });
  it("조건이 여럿이면 모두 만족해야 한다", () => {
    const rules = [rule({ id: "r", teamId: "db", namespace: "AWS/RDS", severity: "CRITICAL", resource: "prod-*" })];
    expect(matchRoutingRule(rules, { namespace: "AWS/RDS", severity: "CRITICAL", resource: "prod-db" })).not.toBeNull();
    expect(matchRoutingRule(rules, { namespace: "AWS/RDS", severity: "CRITICAL", resource: "stage-db" })).toBeNull();
    expect(matchRoutingRule(rules, { namespace: "AWS/RDS", severity: "WARNING", resource: "prod-db" })).toBeNull();
  });
  it("조건 요약", () => {
    expect(describeConditions({ namespace: "AWS/RDS", metric: null, severity: "CRITICAL", resource: null })).toBe("namespace AWS/RDS · severity CRITICAL");
    expect(describeConditions({ namespace: null, metric: null, severity: null, resource: null })).toBe("모든 알람");
  });
});
