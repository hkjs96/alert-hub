import { describe, expect, it } from "vitest";
import {
  inheritedOrderFor,
  resolveResponsibility,
  type AssignmentLite,
} from "@/lib/org/resolve";

// Each test is one of the ownership scenarios from the design conversation
// (docs/org-model.md, docs/requirements.html §4). Names kept as-is for
// traceability. v0.3 replaced OWNER/DEPUTY/MEMBER with an ordered list, so the
// assertions moved from "who is the OWNER" to "whose list was adopted, in what
// order".

const a = (
  contactId: string,
  level: AssignmentLite["level"],
  order = 0,
): AssignmentLite => ({ contactId, level, order });

describe("고객사마다 리더가 앉는 레벨이 다르다", () => {
  it("프로젝트 리더형: 프로젝트 등록이 하위 전체로 상속된다", () => {
    // 고객사 A: 김리더가 프로젝트에 등록 → 어느 서비스/계정 알람이든 김리더
    const r = resolveResponsibility([a("김리더", "project")]);
    expect(r.primaryId).toBe("김리더");
    expect(r.level).toBe("project");
  });

  it("서비스 리더형: 서비스 등록이 잡히고, 아무 데도 없으면 미지정", () => {
    const r = resolveResponsibility([a("박리더", "service")]);
    expect(r.primaryId).toBe("박리더");

    const empty = resolveResponsibility([]);
    expect(empty.primaryId).toBeNull();
    expect(empty.level).toBeNull();
    expect(empty.order).toEqual([]);
  });
});

describe("레벨별 오버라이드 (홍길동/김또깡)", () => {
  it("프로젝트 담당 홍길동, 서비스 A.b만 김또깡", () => {
    const ab = resolveResponsibility([
      a("홍길동", "project"),
      a("김또깡", "service"),
    ]);
    expect(ab.primaryId).toBe("김또깡");
    expect(ab.level).toBe("service");

    // A.a 알람의 체인: 서비스 레벨 행이 없으니 프로젝트로 상속
    const aa = resolveResponsibility([a("홍길동", "project")]);
    expect(aa.primaryId).toBe("홍길동");
  });

  it("계정 레벨이 서비스 레벨을 이긴다", () => {
    const r = resolveResponsibility([
      a("홍길동", "project"),
      a("김또깡", "service"),
      a("최계정", "account"),
    ]);
    expect(r.primaryId).toBe("최계정");
    expect(r.level).toBe("account");
  });
});

describe("순번 (정/부/멤버 라벨 폐기)", () => {
  it("채택된 레벨의 리스트를 순번대로 통째로 쓴다", () => {
    const r = resolveResponsibility([
      a("일순위", "service", 0),
      a("이순위", "service", 1),
      a("삼순위", "service", 2),
    ]);
    expect(r.order).toEqual(["일순위", "이순위", "삼순위"]);
    expect(r.primaryId).toBe("일순위");
  });

  it("order 값이 촘촘하지 않아도 상대 순서만 지키면 된다", () => {
    const r = resolveResponsibility([
      a("나중", "service", 40),
      a("먼저", "service", 10),
    ]);
    expect(r.order).toEqual(["먼저", "나중"]);
  });

  it("레벨 간 병합 금지: 서비스 리스트가 고객사 리스트를 대체한다", () => {
    // 고객사에 2명이 있어도, 서비스에 등록이 있으면 서비스 것만 쓴다
    const r = resolveResponsibility([
      a("고객사1", "customer", 0),
      a("고객사2", "customer", 1),
      a("서비스1", "service", 0),
    ]);
    expect(r.level).toBe("service");
    expect(r.order).toEqual(["서비스1"]);
    expect(r.order).not.toContain("고객사1");
  });

  it("한 레벨에 같은 사람이 두 번 있으면 중복 통지되지 않는다", () => {
    const r = resolveResponsibility([
      a("홍길동", "service", 0),
      a("김또깡", "service", 1),
      a("홍길동", "service", 2),
    ]);
    expect(r.order).toEqual(["홍길동", "김또깡"]);
  });
});

describe("상속 안내 (상위만 본다)", () => {
  it("서비스가 비면 프로젝트 → 고객사 순으로 물려받을 순서를 알려준다", () => {
    const r = inheritedOrderFor("service", [
      a("고객사담당", "customer", 0),
      a("프로젝트담당", "project", 0),
    ]);
    expect(r.level).toBe("project");
    expect(r.order).toEqual(["프로젝트담당"]);
  });

  it("프로젝트가 비면 고객사에서만 물려받는다", () => {
    const r = inheritedOrderFor("project", [a("고객사담당", "customer", 0)]);
    expect(r.level).toBe("customer");
  });

  it("최상위인 고객사는 물려받을 곳이 없다", () => {
    const r = inheritedOrderFor("customer", [a("고객사담당", "customer", 0)]);
    expect(r.level).toBeNull();
    expect(r.order).toEqual([]);
  });

  it("하위(계정/서비스) 등록은 상속으로 올라오지 않는다", () => {
    // 상속은 위에서 아래로만 흐른다 — 프로젝트가 자기 서비스의 등록을
    // "상속받은 것"으로 표시하면 안 된다
    const r = inheritedOrderFor("project", [
      a("서비스담당", "service", 0),
      a("계정담당", "account", 0),
    ]);
    expect(r.level).toBeNull();
    expect(r.order).toEqual([]);
  });
});

describe("겸직/교체", () => {
  it("한 사람이 여러 체인의 담당이어도 각 체인 해석은 독립적이다", () => {
    const chainA = resolveResponsibility([a("홍길동", "project")]);
    const chainB = resolveResponsibility([a("홍길동", "project")]);
    expect(chainA.primaryId).toBe("홍길동");
    expect(chainB.primaryId).toBe("홍길동");
  });

  it("교체 = 행 대체: 해석은 항상 현재 행 기준", () => {
    const r = resolveResponsibility([a("김또깡", "project")]);
    expect(r.primaryId).toBe("김또깡");
    // (과거 알람의 책임 표시는 스냅샷이 담당 — 해석 로직 밖)
  });
});
