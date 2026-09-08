import { beforeEach, describe, expect, it, vi } from "vitest";

// applyRoutingRules: 트리 해석 결과를 규칙 매치 팀으로 덮어쓰되, 규칙이 없거나
// 팀이 비었거나 조회가 죽으면 트리 결과 그대로(fail-open).

const mocks = vi.hoisted(() => ({
  ruleFindMany: vi.fn(),
  contactFindMany: vi.fn(),
  resolveTeamOrders: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    routingRule: { findMany: mocks.ruleFindMany },
    contact: { findMany: mocks.contactFindMany },
  },
}));
// 팀의 "지금 순서"(시프트·대체 근무 반영)는 src/server/oncall.ts 가 계산한다.
vi.mock("@/server/oncall", () => ({ resolveTeamOrders: mocks.resolveTeamOrders }));

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
const dbContacts = [
  { id: "c-kim", name: "김도윤", department: "SRE팀", slackId: "U1", email: null, phone: null },
  { id: "c-lee", name: "이서연", department: "SRE팀", slackId: null, email: null, phone: null },
];
function teamOrder(order: string[], labelOf: [string, string][] = []) {
  return new Map([
    ["t-db", { name: "DB팀", timezone: "Asia/Seoul", order, source: { kind: "default" }, labelOf: new Map(labelOf) }],
  ]);
}

beforeEach(() => vi.clearAllMocks());

describe("라우팅 규칙 적용", () => {
  it("매치되면 팀 멤버가 순서를 통째로 대체하고 스냅샷에 규칙이 남는다", async () => {
    mocks.ruleFindMany.mockResolvedValue([rdsRule]);
    mocks.resolveTeamOrders.mockResolvedValue(teamOrder(["c-kim", "c-lee"]));
    mocks.contactFindMany.mockResolvedValue(dbContacts);
    const out = await applyRoutingRules(tree, { namespace: "AWS/RDS", severity: "WARNING" });
    expect(out.responsibility.order).toEqual(["c-kim", "c-lee"]);
    expect(out.responsibility.primaryId).toBe("c-kim");
    expect(out.contacts.map((c) => c.team)).toEqual(["DB팀", "DB팀"]);
    expect(out.rule).toEqual({ id: "r1", name: "RDS → DB팀", team: "DB팀" });
    const snap = buildOwnershipSnapshot(out);
    expect(snap.rule?.name).toBe("RDS → DB팀");
    expect(snap.order.map((o) => o.name)).toEqual(["김도윤", "이서연"]);
    expect(mocks.resolveTeamOrders).toHaveBeenCalledWith(["t-db"]);
  });

  it("팀에 시프트가 켜져 있으면 당번이 앞에 오고 라벨이 스냅샷에 남는다", async () => {
    mocks.ruleFindMany.mockResolvedValue([rdsRule]);
    mocks.resolveTeamOrders.mockResolvedValue(teamOrder(["c-lee", "c-kim"], [["c-lee", "야간"]]));
    mocks.contactFindMany.mockResolvedValue(dbContacts);
    const out = await applyRoutingRules(tree, { namespace: "AWS/RDS", severity: "WARNING" });
    expect(out.responsibility.primaryId).toBe("c-lee");
    expect(out.contacts.map((c) => c.shift)).toEqual(["야간", null]);
    const snap = buildOwnershipSnapshot(out);
    expect(snap.order.map((o) => `${o.name}:${o.shift ?? "-"}`)).toEqual(["이서연:야간", "김도윤:-"]);
  });

  it("고객사 규칙만 조회하고, 매치가 없으면 트리 결과 그대로", async () => {
    mocks.ruleFindMany.mockResolvedValue([rdsRule]);
    const out = await applyRoutingRules(tree, { namespace: "AWS/ELB", severity: "WARNING" });
    expect(out).toBe(tree);
    expect(out.rule).toBeUndefined();
    expect(mocks.ruleFindMany.mock.calls[0][0].where).toEqual({ customerId: "cu1", enabled: true });
    expect(mocks.resolveTeamOrders).not.toHaveBeenCalled();
  });

  it("serviceId 한정 규칙은 체인의 서비스로 판정한다", async () => {
    mocks.ruleFindMany.mockResolvedValue([{ ...rdsRule, namespace: null, serviceId: "s-other" }]);
    expect(await applyRoutingRules(tree, { severity: "WARNING" })).toBe(tree);
    mocks.ruleFindMany.mockResolvedValue([{ ...rdsRule, namespace: null, serviceId: "s1" }]);
    mocks.resolveTeamOrders.mockResolvedValue(teamOrder(["c-kim", "c-lee"]));
    mocks.contactFindMany.mockResolvedValue(dbContacts);
    expect((await applyRoutingRules(tree, { severity: "WARNING" })).rule?.id).toBe("r1");
  });

  it("매치된 팀에 활성 멤버가 없으면 트리 순서를 지킨다", async () => {
    mocks.ruleFindMany.mockResolvedValue([rdsRule]);
    mocks.resolveTeamOrders.mockResolvedValue(teamOrder([]));
    const out = await applyRoutingRules(tree, { namespace: "AWS/RDS", severity: "WARNING" });
    expect(out).toBe(tree);
  });

  it("조회가 죽어도 통지는 트리 순서로 나간다 (fail-open)", async () => {
    mocks.ruleFindMany.mockRejectedValue(new Error("db down"));
    const out = await applyRoutingRules(tree, { namespace: "AWS/RDS", severity: "WARNING" });
    expect(out).toBe(tree);
  });
});
