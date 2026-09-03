import { describe, expect, it } from "vitest";
import {
  expandAssignments,
  resolveResponsibility,
  type AssignmentRowLite,
} from "@/lib/org/resolve";

// Phase 1 of the org rework: a scope's ordered list may contain a *team*
// instead of a person. Teams expand to their members, in the team's own
// order, at the slot the team occupies — so "최민서 → DB팀 → 박지훈" pages
// 최민서, then every DB팀 member, then 박지훈.

const person = (contactId: string, order: number): AssignmentRowLite => ({
  contactId,
  teamId: null,
  level: "service",
  order,
});
const team = (teamId: string, order: number): AssignmentRowLite => ({
  contactId: null,
  teamId,
  level: "service",
  order,
});

describe("팀 항목 펼치기", () => {
  it("팀은 자기 순번 자리에 멤버를 팀 순서대로 끼워 넣는다", () => {
    const rows = [person("최민서", 0), team("db", 1), person("박지훈", 2)];
    const members = new Map([["db", ["김도윤", "이서연"]]]);
    const r = resolveResponsibility(expandAssignments(rows, members));
    expect(r.order).toEqual(["최민서", "김도윤", "이서연", "박지훈"]);
    expect(r.primaryId).toBe("최민서");
  });

  it("팀이 첫 칸이면 팀의 첫 멤버가 1순위가 된다", () => {
    const rows = [team("infra", 0), person("최민서", 1)];
    const members = new Map([["infra", ["한지우", "정우진"]]]);
    const r = resolveResponsibility(expandAssignments(rows, members));
    expect(r.primaryId).toBe("한지우");
    expect(r.order).toEqual(["한지우", "정우진", "최민서"]);
  });

  it("멤버가 없는 팀은 건너뛴다 (미지정으로 떨어지지 않는다)", () => {
    const rows = [team("empty", 0), person("최민서", 1)];
    const r = resolveResponsibility(expandAssignments(rows, new Map()));
    expect(r.order).toEqual(["최민서"]);
  });

  it("팀 멤버가 같은 스코프에 직접 등록돼 있으면 첫 등장만 남는다", () => {
    // 김도윤이 개인으로 0번, DB팀(김도윤→이서연)이 1번 → 김도윤은 한 번만
    const rows = [person("김도윤", 0), team("db", 1)];
    const members = new Map([["db", ["김도윤", "이서연"]]]);
    const r = resolveResponsibility(expandAssignments(rows, members));
    expect(r.order).toEqual(["김도윤", "이서연"]);
  });

  it("팀 멤버가 1000명 미만이면 다음 순번과 섞이지 않는다", () => {
    const many = Array.from({ length: 50 }, (_, i) => `m${i}`);
    const rows = [team("big", 0), person("뒤", 1)];
    const r = resolveResponsibility(expandAssignments(rows, new Map([["big", many]])));
    expect(r.order.at(-1)).toBe("뒤");
    expect(r.order.length).toBe(51);
  });

  it("레벨 규칙은 그대로: 서비스에 팀이 있으면 고객사 목록은 무시된다", () => {
    const rows: AssignmentRowLite[] = [
      { contactId: "고객사담당", teamId: null, level: "customer", order: 0 },
      team("db", 0),
    ];
    const r = resolveResponsibility(expandAssignments(rows, new Map([["db", ["김도윤"]]])));
    expect(r.level).toBe("service");
    expect(r.order).toEqual(["김도윤"]);
  });
});
