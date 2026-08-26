import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedAlert } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  eventCreate: vi.fn(),
  notifyAll: vi.fn(),
  ownership: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    alert: {
      findUnique: mocks.findUnique,
      create: mocks.create,
      updateMany: mocks.updateMany,
    },
    alertEvent: { create: mocks.eventCreate },
  },
}));

vi.mock("@/lib/notify", () => ({ notifyAll: mocks.notifyAll }));

vi.mock("@/server/org", () => ({ getOwnershipByAwsAccount: mocks.ownership }));

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
    expect(mocks.notifyAll.mock.calls[0][1]).toEqual({ alertId: "a1" });
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
    expect(call.where.status).toEqual({ not: "FIRING" });
    expect(call.data.count).toEqual({ increment: 1 });
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

describe("ingestAlert — FIRING 통지에 담당 순서를 싣는다", () => {
  it("계정이 체인으로 해석되면 순서대로 assignees가 전달된다", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "a1" });
    mocks.ownership.mockResolvedValue({
      chain: {},
      responsibility: { level: "service", order: ["c1", "c2"], primaryId: "c1" },
      contacts: [
        { id: "c1", name: "최민서", department: "인프라팀", slackId: "U123" },
        { id: "c2", name: "김도윤", department: "SRE팀", slackId: null },
      ],
    });

    await ingestAlert(alert({ accountId: "123456789012" }));

    expect(mocks.ownership).toHaveBeenCalledWith("123456789012");
    const ctx = mocks.notifyAll.mock.calls[0][1];
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
    expect(mocks.notifyAll.mock.calls[0][1]).toEqual({ alertId: "a1" });
  });

  it("해석이 죽어도 통지는 나간다", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "a1" });
    mocks.ownership.mockRejectedValue(new Error("db down"));

    await ingestAlert(alert({ accountId: "123456789012" }));

    expect(mocks.notifyAll).toHaveBeenCalledOnce();
    expect(mocks.notifyAll.mock.calls[0][1]).toEqual({ alertId: "a1" });
  });
});
