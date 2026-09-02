import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedAlert } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  eventCreate: vi.fn(),
  notifLogCreateMany: vi.fn(),
  notifyAll: vi.fn(),
  ownership: vi.fn(),
  silenceFindFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    alert: {
      findUnique: mocks.findUnique,
      create: mocks.create,
      updateMany: mocks.updateMany,
    },
    alertEvent: { create: mocks.eventCreate },
    notificationLog: { createMany: mocks.notifLogCreateMany },
    silence: { findFirst: mocks.silenceFindFirst },
  },
}));

// 팬아웃은 아웃박스 경유로 바뀌었다 — ingest의 계약은 "enqueueAndSend가
// (alertId, alert, ctx)로 호출되는가/안 되는가"다. 큐 자체(재시도, 로그)는
// tests/notify-queue.test.ts가 고정한다.
vi.mock("@/server/notify-queue", () => ({
  enqueueAndSend: mocks.notifyAll,
  digestWindowSeconds: () => 0,
}));

vi.mock("@/server/org", async (importOriginal) => ({
  // buildOwnershipSnapshot은 순수 함수라 실제 구현을 쓴다 — 스냅샷 형태까지
  // 테스트가 검증하게 된다. DB를 만지는 조회만 모킹.
  ...(await importOriginal<typeof import("@/server/org")>()),
  getOwnershipByAwsAccount: mocks.ownership,
}));

import { ingestAlert } from "@/server/alerts";

function alert(overrides: Partial<NormalizedAlert> = {}): NormalizedAlert {
  return {
    fingerprint: "cw:arn:alarm/db",
    title: "SEV-1 prod-db CPU",
    source: "cloudwatch",
    severity: "SEV-1",
    status: "FIRING",
    metric: "CPUUtilization",
    namespace: "AWS/RDS",
    region: "us-east-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eventCreate.mockResolvedValue({ id: "ev1" });
  mocks.notifyAll.mockResolvedValue(undefined);
  mocks.ownership.mockResolvedValue(null); // 기본: 미매핑/미배정
  mocks.silenceFindFirst.mockResolvedValue(null); // 기본: 뮤트 없음
});

describe("ingestAlert — create path", () => {
  it("creates a new FIRING alert with its first event and notifies once", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "a1" });

    const res = await ingestAlert(alert());

    expect(res).toMatchObject({ alertId: "a1", created: true, firedTransition: true });
    expect(mocks.create).toHaveBeenCalledOnce();
    const data = mocks.create.mock.calls[0][0].data;
    expect(data.count).toBe(1);
    expect(data.events.create.status).toBe("FIRING");
    expect(mocks.notifyAll).toHaveBeenCalledOnce();
    expect(mocks.notifyAll.mock.calls[0][2]).toEqual({ alertId: "a1" });
  });

  it("does not notify when a new alert arrives already RESOLVED", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "a1" });

    const res = await ingestAlert(alert({ status: "RESOLVED" }));

    expect(res.firedTransition).toBe(false);
    expect(mocks.notifyAll).not.toHaveBeenCalled();
  });

  it("survives losing a concurrent-create race (P2002 falls through to update)", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(null) // existence check: not there yet
      .mockResolvedValueOnce({ id: "a1" }); // id lookup after losing the race
    mocks.create.mockRejectedValue({ code: "P2002" });
    mocks.updateMany.mockResolvedValue({ count: 0 }); // winner already set FIRING

    const res = await ingestAlert(alert());

    expect(res).toMatchObject({ alertId: "a1", created: false, firedTransition: false });
    // the loser must not double-notify
    expect(mocks.notifyAll).not.toHaveBeenCalled();
    expect(mocks.eventCreate).toHaveBeenCalledOnce();
  });

  it("rethrows non-unique-violation errors", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockRejectedValue(new Error("connection refused"));

    await expect(ingestAlert(alert())).rejects.toThrow("connection refused");
  });
});

describe("ingestAlert — update path", () => {
  beforeEach(() => {
    mocks.findUnique.mockResolvedValue({ id: "a1" });
  });

  it("a sparse follow-up must NOT erase enrichment learned earlier", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    // CloudWatch OK resend without Trigger: no metric/namespace/threshold.
    await ingestAlert(
      alert({
        status: "RESOLVED",
        severity: "UNKNOWN",
        metric: undefined,
        namespace: undefined,
        region: undefined,
      }),
    );

    const data = mocks.updateMany.mock.calls[0][0].data;
    // undefined => Prisma skips the column => stored enrichment survives
    expect(data.metric).toBeUndefined();
    expect(data.namespace).toBeUndefined();
    expect(data.region).toBeUndefined();
    expect(data.severity).toBeUndefined(); // UNKNOWN must not downgrade SEV-1
    expect(data.status).toBe("RESOLVED"); // but the status change applies
  });

  it("bumps count and notifies only on a genuine transition into FIRING", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 }); // guard matched: was not FIRING

    const res = await ingestAlert(alert());

    expect(res.firedTransition).toBe(true);
    const call = mocks.updateMany.mock.calls[0][0];
    expect(call.where.status).toEqual({ notIn: ["FIRING", "ACKNOWLEDGED"] });
    expect(call.data.count).toEqual({ increment: 1 });
    // 재발화 = 새 인시던트: 에스컬레이션 사다리도 처음부터
    expect(call.data.escalationStep).toBe(1);
    expect(call.data.escalatedAt).toBeNull();
    expect(mocks.notifyAll).toHaveBeenCalledOnce();
  });

  it("re-fired duplicates (already FIRING) neither bump count nor notify", async () => {
    mocks.updateMany
      .mockResolvedValueOnce({ count: 0 }) // guarded update missed: already FIRING
      .mockResolvedValueOnce({ count: 1 }); // plain update applies fields

    const res = await ingestAlert(alert());

    expect(res.firedTransition).toBe(false);
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    const second = mocks.updateMany.mock.calls[1][0];
    expect(second.data.count).toBeUndefined();
    expect(mocks.notifyAll).not.toHaveBeenCalled();
  });

  it("ack는 끈끈하다 — FIRING 재수신이 ACKNOWLEDGED를 해제하지 않는다 (2c)", async () => {
    // Prometheus/Grafana는 계속 firing인 알람을 주기적으로 재전송한다. 가드가
    // ACKNOWLEDGED에 막혀 count 0 → fallback 갱신은 status를 건드리면 안 된다.
    mocks.updateMany
      .mockResolvedValueOnce({ count: 0 }) // guard: FIRING도 ACK도 매치 안 함
      .mockResolvedValueOnce({ count: 1 });

    const res = await ingestAlert(alert());

    expect(res.firedTransition).toBe(false);
    const fallback = mocks.updateMany.mock.calls[1][0];
    expect(fallback.data.status).toBeUndefined(); // ACK 유지
    expect(fallback.data.count).toBeUndefined(); // 재발화 아님
    expect(mocks.notifyAll).not.toHaveBeenCalled(); // 재페이징 금지
    // 수신 사실 자체는 이력에 남는다
    expect(mocks.eventCreate.mock.calls[0][0].data.status).toBe("FIRING");
  });

  it("INSUFFICIENT_DATA 플랩도 ACKNOWLEDGED를 해제하지 않는다", async () => {
    mocks.updateMany
      .mockResolvedValueOnce({ count: 0 }) // guard: status not ACKNOWLEDGED 미매치
      .mockResolvedValueOnce({ count: 1 });

    await ingestAlert(alert({ status: "INSUFFICIENT_DATA" }));

    const guard = mocks.updateMany.mock.calls[0][0];
    expect(guard.where.status).toEqual({ not: "ACKNOWLEDGED" });
    expect(guard.data.status).toBe("INSUFFICIENT_DATA");
    const fallback = mocks.updateMany.mock.calls[1][0];
    expect(fallback.data.status).toBeUndefined();
  });

  it("RESOLVED(OK) 수신은 ACKNOWLEDGED를 포함한 모든 상태에서 적용된다", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await ingestAlert(alert({ status: "RESOLVED" }));

    expect(mocks.updateMany).toHaveBeenCalledOnce();
    const call = mocks.updateMany.mock.calls[0][0];
    expect(call.where.status).toBeUndefined(); // 상태 가드 없음
    expect(call.data.status).toBe("RESOLVED");
  });

  it("always appends to the event history", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await ingestAlert(alert({ status: "RESOLVED", stateReason: "back to normal" }));

    expect(mocks.eventCreate).toHaveBeenCalledOnce();
    expect(mocks.eventCreate.mock.calls[0][0].data).toMatchObject({
      alertId: "a1",
      status: "RESOLVED",
      stateReason: "back to normal",
    });
  });
});

const OWNERSHIP = {
  chain: {
    customer: { id: "cust1", name: "네오위즈" },
    project: { id: "proj1", name: "게임플랫폼" },
    service: { id: "svc1", name: "결제서비스" },
    account: { id: "acc1", accountId: "123456789012", alias: "payment-prod", environment: "prd" },
  },
  responsibility: { level: "service" as const, order: ["c1", "c2"], primaryId: "c1" },
  contacts: [
    { id: "c1", name: "최민서", department: "인프라팀", slackId: "U123" },
    { id: "c2", name: "김도윤", department: "SRE팀", slackId: null },
  ],
};

describe("ingestAlert — FIRING 통지에 담당 순서를 싣는다", () => {
  it("계정이 체인으로 해석되면 순서대로 assignees가 전달된다", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "a1" });
    mocks.ownership.mockResolvedValue(OWNERSHIP);

    await ingestAlert(alert({ accountId: "123456789012" }));

    expect(mocks.ownership).toHaveBeenCalledWith("123456789012");
    const ctx = mocks.notifyAll.mock.calls[0][2];
    expect(ctx.alertId).toBe("a1");
    expect(ctx.assignees).toEqual([
      { name: "최민서", slackId: "U123" },
      { name: "김도윤", slackId: null },
    ]);
  });

  it("계정이 없으면 해석을 시도하지 않는다", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "a1" });

    await ingestAlert(alert());

    expect(mocks.ownership).not.toHaveBeenCalled();
    expect(mocks.notifyAll.mock.calls[0][2]).toEqual({ alertId: "a1" });
  });

  it("해석이 죽어도 통지는 나간다", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "a1" });
    mocks.ownership.mockRejectedValue(new Error("db down"));

    await ingestAlert(alert({ accountId: "123456789012" }));

    expect(mocks.notifyAll).toHaveBeenCalledOnce();
    expect(mocks.notifyAll.mock.calls[0][2]).toEqual({ alertId: "a1" });
  });
});

describe("ingestAlert — 수신 시점 스냅샷 (BR-05)", () => {
  it("신규 생성 시 체인+순서가 스냅샷으로 얼려진다", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "a1" });
    mocks.ownership.mockResolvedValue(OWNERSHIP);

    await ingestAlert(alert({ accountId: "123456789012" }));

    const snap = mocks.create.mock.calls[0][0].data.ownershipSnapshot;
    expect(snap.level).toBe("service");
    expect(snap.chain.customerName).toBe("네오위즈");
    expect(snap.chain.serviceName).toBe("결제서비스");
    expect(snap.order.map((o: { name: string }) => o.name)).toEqual([
      "최민서",
      "김도윤",
    ]);
    expect(typeof snap.capturedAt).toBe("string");
  });

  it("FIRING이 아닌 신규 접수도 스냅샷은 저장하고 통지만 건너뛴다", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "a1" });
    mocks.ownership.mockResolvedValue(OWNERSHIP);

    await ingestAlert(alert({ status: "RESOLVED", accountId: "123456789012" }));

    expect(mocks.create.mock.calls[0][0].data.ownershipSnapshot).toBeDefined();
    expect(mocks.notifyAll).not.toHaveBeenCalled();
  });

  it("재발화(FIRING 전환) 승자는 스냅샷을 그때의 순서로 갱신한다", async () => {
    mocks.findUnique.mockResolvedValue({ id: "a1" });
    mocks.updateMany.mockResolvedValue({ count: 1 }); // 전환 가드 매치
    mocks.ownership.mockResolvedValue(OWNERSHIP);

    await ingestAlert(alert({ accountId: "123456789012" }));

    // 1번째 updateMany = 본문 갱신(count++), 2번째 = 스냅샷 갱신
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    const snapCall = mocks.updateMany.mock.calls[1][0];
    expect(snapCall.data.ownershipSnapshot.order[0].name).toBe("최민서");
    expect(mocks.notifyAll).toHaveBeenCalledOnce();
  });

  it("이미 FIRING인 중복 수신은 스냅샷을 건드리지 않는다", async () => {
    mocks.findUnique.mockResolvedValue({ id: "a1" });
    mocks.updateMany.mockResolvedValue({ count: 0 }); // 전환 아님
    mocks.ownership.mockResolvedValue(OWNERSHIP);

    await ingestAlert(alert({ accountId: "123456789012" }));

    expect(mocks.ownership).not.toHaveBeenCalled();
    expect(
      mocks.updateMany.mock.calls.some((c) => c[0].data.ownershipSnapshot),
    ).toBe(false);
  });

  it("미매핑 계정은 스냅샷 없이 저장된다", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "a1" });
    mocks.ownership.mockResolvedValue(null);

    await ingestAlert(alert({ accountId: "999999999999" }));

    expect(mocks.create.mock.calls[0][0].data.ownershipSnapshot).toBeUndefined();
  });
});

describe("ingest × silence(뮤트)", () => {
  it("뮤트가 덮는 FIRING 전이는 수집·이벤트는 그대로, 통지만 생략한다", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "a1" });
    mocks.silenceFindFirst.mockResolvedValue({
      id: "sil1",
      alertId: null,
      customerId: null,
      projectId: null,
      serviceId: "svc1",
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60 * 60_000),
      reason: "정기 배포",
      createdBy: null,
      revokedAt: null,
    });

    const result = await ingestAlert(alert());

    // 알람과 이벤트는 평소처럼 만들어진다 — 뮤트는 통지만 멈춘다.
    expect(result).toMatchObject({ alertId: "a1", firedTransition: true });
    expect(mocks.create).toHaveBeenCalledOnce();
    // 통지 팬아웃과 통지 이력은 없다.
    expect(mocks.notifyAll).not.toHaveBeenCalled();
    expect(mocks.notifLogCreateMany).not.toHaveBeenCalled();
  });

  it("뮤트 조회가 죽으면 fail-open — 통지는 나간다", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "a1" });
    mocks.silenceFindFirst.mockRejectedValue(new Error("db down"));
    mocks.notifyAll.mockResolvedValue([{ channel: "slack", status: "sent" }]);

    await ingestAlert(alert());
    expect(mocks.notifyAll).toHaveBeenCalledOnce();
  });
});
