import { describe, expect, it } from "vitest";
import {
  resolveResponsibility,
  type AssignmentLite,
} from "@/lib/org/resolve";

// Each test is one of the ownership scenarios from the design conversation
// (docs/org-model.md). Names kept as-is for traceability.

const a = (
  contactId: string,
  kind: string,
  level: AssignmentLite["level"],
  order?: number,
): AssignmentLite => ({ contactId, kind, level, order });

describe("고객사마다 리더가 앉는 레벨이 다르다", () => {
  it("프로젝트 리더형: 프로젝트 OWNER가 하위 전체로 상속된다", () => {
    // 고객사 A: 김리더가 프로젝트 담당 → 어느 서비스/계정 알람이든 김리더
    const r = resolveResponsibility([a("김리더", "OWNER", "project")]);
    expect(r.ownerId).toBe("김리더");
  });

  it("서비스 리더형: 서비스 OWNER가 잡히고, 없는 서비스는 미지정", () => {
    // 고객사 B: 서비스에만 리더 지정 — 이 체인엔 서비스 OWNER가 있음
    const r = resolveResponsibility([a("박리더", "OWNER", "service")]);
    expect(r.ownerId).toBe("박리더");
    // 리더 미지정 서비스의 체인 (상위에도 아무도 없음)
    const empty = resolveResponsibility([]);
    expect(empty.ownerId).toBeNull();
    expect(empty.allIds).toEqual([]);
  });
});

describe("레벨별 오버라이드 (홍길동/김또깡)", () => {
  it("프로젝트 담당 홍길동, 서비스 A.b만 김또깡", () => {
    // A.b 알람의 체인: 서비스 OWNER 김또깡이 프로젝트 OWNER 홍길동을 이긴다
    const ab = resolveResponsibility([
      a("홍길동", "OWNER", "project"),
      a("김또깡", "OWNER", "service"),
    ]);
    expect(ab.ownerId).toBe("김또깡");

    // A.a 알람의 체인: 서비스 레벨 행이 없으니 프로젝트로 상속
    const aa = resolveResponsibility([a("홍길동", "OWNER", "project")]);
    expect(aa.ownerId).toBe("홍길동");
  });

  it("계정 레벨이 서비스 레벨을 이긴다", () => {
    const r = resolveResponsibility([
      a("홍길동", "OWNER", "project"),
      a("김또깡", "OWNER", "service"),
      a("최계정", "OWNER", "account"),
    ]);
    expect(r.ownerId).toBe("최계정");
  });
});

describe("정/부/멤버", () => {
  it("정 1명 + 부 N명 + 순서 없는 멤버 N명", () => {
    const r = resolveResponsibility([
      a("정담당", "OWNER", "service"),
      a("부담당1", "DEPUTY", "service", 1),
      a("부담당2", "DEPUTY", "service", 2),
      a("멤버A", "MEMBER", "service"),
      a("멤버B", "MEMBER", "project"),
    ]);
    expect(r.ownerId).toBe("정담당");
    expect(r.deputyIds).toEqual(["부담당1", "부담당2"]);
    // 멤버는 체인 전 레벨 합집합 (프로젝트에 등록된 멤버B도 포함)
    expect(r.memberIds).toEqual(expect.arrayContaining(["멤버A", "멤버B"]));
  });

  it("부담당은 독립 워크: 서비스에 정만 있고 부는 프로젝트에 있어도 잡힌다", () => {
    const r = resolveResponsibility([
      a("정담당", "OWNER", "service"),
      a("부담당", "DEPUTY", "project"),
    ]);
    expect(r.ownerId).toBe("정담당");
    expect(r.deputyIds).toEqual(["부담당"]);
  });

  it("같은 사람이 오너면서 멤버로도 걸려 있으면 중복 제거된다", () => {
    const r = resolveResponsibility([
      a("홍길동", "OWNER", "project"),
      a("홍길동", "MEMBER", "service"),
      a("멤버A", "MEMBER", "service"),
    ]);
    expect(r.ownerId).toBe("홍길동");
    expect(r.memberIds).toEqual(["멤버A"]);
    expect(r.allIds).toEqual(["홍길동", "멤버A"]);
  });
});

describe("겸직/교체", () => {
  it("한 사람이 여러 체인의 담당이어도 각 체인 해석은 독립적이다", () => {
    // 프로젝트 A 체인과 프로젝트 B 체인 각각 홍길동
    const chainA = resolveResponsibility([a("홍길동", "OWNER", "project")]);
    const chainB = resolveResponsibility([a("홍길동", "OWNER", "project")]);
    expect(chainA.ownerId).toBe("홍길동");
    expect(chainB.ownerId).toBe("홍길동");
  });

  it("교체 = 행 대체: 해석은 항상 현재 행 기준", () => {
    // 홍길동 → 김또깡으로 교체된 뒤의 체인
    const r = resolveResponsibility([a("김또깡", "OWNER", "project")]);
    expect(r.ownerId).toBe("김또깡");
    // (과거 알람의 책임 표시는 2b의 스냅샷이 담당 — 해석 로직 밖)
  });
});
