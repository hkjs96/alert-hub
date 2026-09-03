import { beforeEach, describe, expect, it, vi } from "vitest";

// applyRoutingRules: 트리 해석 결과를 규칙 매치 팀으로 덮어쓰되, 규칙이 없거나
// 팀이 비었거나 조회가 죽으면 트리 결과 그대로(fail-open).

const mocks = vi.hoisted(() => ({
  ruleFindMany: vi.fn(),
  memberFindMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    routingRule: { findMany: mocks.ruleFindMany },
    teamMember: { findMany: mocks.memberFindMany },
  },
}));

import { applyRoutingRules } from "@/server/routing";
import { buildOwnershipSnapshot, type OwnershipInfo } from "@/server/org";

const tree: OwnershipInfo = {
  chain: {
    account: { id: "am1", accountId: "123456789012", alias: "prod", environment: "prd" },
    service: { id: "s1", name: "결제서비스" },
    project: { id: "p1", name: "게임플랫폼" },
    customer: { id: "cu1", name: "네오위즈" },
  },
  responsibility: { level: "service", order: ["c-min", "c-park"], primaryId: "c-min" },
  contacts: [
    { id: "c-min", name: "최민서", department: "인프라팀", slackId: null, email: null, phone: null },
    { id: "c-park", name: "박준혁", department: "온콜팀", slackId: null, email: null, phone: null },
  ],
};
const rdsRule = { id: "r1", name: "RDS → DB팀", priority: 10, enabled: true, namespace: "AWS/RDS", metric: null, severity: null, resource: null, serviceId: null, teamId: "t-db", customerId: "cu1" };
const dbMembers = [
  { contactId: "c-kim", team: { name: "DB팀" }, contact: { id: "c-kim", name: "김도윤", department: "SRE팀", slackId: "U1", email: null, phone: null } },
  { contactId: "c-lee", team: { name: "DB팀" }, contact: { id: "c-lee", name: "이서연", department: "SRE팀", slackId: null, email: null, phone: null } },
];

beforeEach(() => vi.clearAllMocks());

describe("라우팅 규칙 적용", () => {
  it("매치되면 팀 멤버가 순서를 통째로 대체하고 스냅샷에 규칙이 남는다", async () => {
    mocks.ruleFindMany.mockResolvedValue([rdsRule]);
    mocks.memberFindMany.mockResolvedValue(dbMembers);
    const out = await applyRoutingRules(tree, { namespace: "AWS/RDS", severity: "WARNING" });
    expect(out.responsibility.order).toEqual(["c-kim", "c-lee"]);
    expect(out.responsibility.primaryId).toBe("c-kim");
    expect(out.contacts.map((c) => c.team)).toEqual(["DB팀", "DB팀"]);
    expect(out.rule).toEqual({ id: "r1", name: "RDS → DB팀", team: "DB팀" });
    const snap = buildOwnershipSnapshot(out);
    expect(snap.rule?.name).toBe("RDS → DB팀");
    expect(snap.order.map((o) => o.name)).toEqual(["김도윤", "이서연"]);
    // 활성 멤버만, 팀 순서로
    expect(mocks.memberFindMany.mock.calls[0][0].where).toEqual({ teamId: "t-db", contact: { active: true } });
  });

  it("고객사 규칙만 조회하고, 매치가 없으면 트리 결과 그대로", async () => {
    mocks.ruleFindMany.mockResolvedValue([rdsRule]);
    const out = await applyRoutingRules(tree, { namespace: "AWS/ELB", severity: "WARNING" });
    expect(out).toBe(tree);
    expect(out.rule).toBeUndefined();
    expect(mocks.ruleFindMany.mock.calls[0][0].where).toEqual({ customerId: "cu1", enabled: true });
    expect(mocks.memberFindMany).not.toHaveBeenCalled();
  });

  it("serviceId 한정 규칙은 체인의 서비스로 판정한다", async () => {
    mocks.ruleFindMany.mockResolvedValue([{ ...rdsRule, namespace: null, serviceId: "s-other" }]);
    expect(await applyRoutingRules(tree, { severity: "WARNING" })).toBe(tree);
    mocks.ruleFindMany.mockResolvedValue([{ ...rdsRule, namespace: null, serviceId: "s1" }]);
    mocks.memberFindMany.mockResolvedValue(dbMembers);
    expect((await applyRoutingRules(tree, { severity: "WARNING" })).rule?.id).toBe("r1");
  });

  it("매치된 팀에 활성 멤버가 없으면 트리 순서를 지킨다", async () => {
    mocks.ruleFindMany.mockResolvedValue([rdsRule]);
    mocks.memberFindMany.mockResolvedValue([]);
    const out = await applyRoutingRules(tree, { namespace: "AWS/RDS", severity: "WARNING" });
    expect(out).toBe(tree);
  });

  it("조회가 죽어도 통지는 트리 순서로 나간다 (fail-open)", async () => {
    mocks.ruleFindMany.mockRejectedValue(new Error("db down"));
    const out = await applyRoutingRules(tree, { namespace: "AWS/RDS", severity: "WARNING" });
    expect(out).toBe(tree);
  });
});
