import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/cron/escalate (Phase 3). 인증, 낙관적 선점, 이벤트 append, 통지
// 대상 선택을 검증한다 — 시점 판정 자체는 tests/escalation.test.ts가 고정한다.

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  eventCreate: vi.fn(),
  contactFindUnique: vi.fn(),
  notifLogCreateMany: vi.fn(),
  notifyAll: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    alert: { findMany: mocks.findMany, updateMany: mocks.updateMany },
    alertEvent: { create: mocks.eventCreate },
    contact: { findUnique: mocks.contactFindUnique },
    notificationLog: { createMany: mocks.notifLogCreateMany },
  },
}));

vi.mock("@/lib/notify", () => ({ notifyAll: mocks.notifyAll }));

import { GET } from "@/app/api/cron/escalate/route";

const NOW = Date.now();
const minAgo = (m: number) => new Date(NOW - m * 60_000);

function firingAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    fingerprint: "cw:arn:alarm/db",
    title: "SEV-1 prod-db CPU",
    description: null,
    source: "cloudwatch",
    severity: "SEV-1",
    status: "FIRING",
    resource: "prod-db",
    metric: null,
    namespace: null,
    value: null,
    threshold: null,
    comparison: null,
    region: null,
    accountId: "123456789012",
    stateReason: null,
    escalationStep: 1,
    escalatedAt: null,
    ownershipSnapshot: {
      capturedAt: minAgo(30).toISOString(),
      level: "service",
      chain: {
        customerId: "cust1",
        customerName: "네오위즈",
        projectId: "proj1",
        projectName: "게임플랫폼",
        serviceId: "svc1",
        serviceName: "결제서비스",
        accountMapId: "acc1",
        accountAlias: "payment-prod",
        environment: "prd",
      },
      order: [
        { contactId: "c1", name: "최민서", department: "인프라팀" },
        { contactId: "c2", name: "김도윤", department: "SRE팀" },
      ],
    },
    ...overrides,
  };
}

function call(auth?: { bearer?: string; query?: string }) {
  const url =
    "http://test.local/api/cron/escalate" +
    (auth?.query ? `?secret=${auth.query}` : "");
  const headers = auth?.bearer
    ? { authorization: `Bearer ${auth.bearer}` }
    : undefined;
  return GET(new Request(url, { headers }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cr3t");
  mocks.findMany.mockResolvedValue([]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.eventCreate.mockResolvedValue({ id: "ev1" });
  mocks.notifyAll.mockResolvedValue(undefined);
  mocks.contactFindUnique.mockResolvedValue({
    id: "c2",
    name: "김도윤",
    slackId: "U2",
    email: "dy@corp.test",
    phone: "+821012345678",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth", () => {
  it("CRON_SECRET 미설정이면 503 — 기능이 꺼진 것", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call({ query: "anything" })).status).toBe(503);
  });

  it("비밀이 틀리면 401, Bearer 헤더든 쿼리든 맞으면 200", async () => {
    expect((await call({ query: "wrong" })).status).toBe(401);
    expect((await call()).status).toBe(401);
    expect((await call({ bearer: "s3cr3t" })).status).toBe(200);
    expect((await call({ query: "s3cr3t" })).status).toBe(200);
  });
});

describe("escalation tick", () => {
  it("N분 미ack FIRING을 다음 순위에게 넘긴다 — 선점·이벤트·통지까지", async () => {
    mocks.findMany.mockResolvedValue([firingAlert()]);
    mocks.notifyAll.mockResolvedValue([{ channel: "slack", status: "sent" }]);

    const res = await call({ query: "s3cr3t" });
    expect(await res.json()).toMatchObject({ checked: 1, escalated: 1 });

    // 낙관적 선점: 읽은 step 그대로를 WHERE에 싣는다
    const claim = mocks.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({
      id: "a1",
      status: "FIRING",
      escalationStep: 1,
    });
    expect(claim.data.escalationStep).toBe(2);
    expect(claim.data.escalatedAt).toBeInstanceOf(Date);

    // 타임라인에 남고
    expect(mocks.eventCreate.mock.calls[0][0].data).toMatchObject({
      alertId: "a1",
      status: "ESCALATED",
    });
    expect(mocks.eventCreate.mock.calls[0][0].data.stateReason).toContain(
      "2순위 김도윤",
    );

    // 다음 순위 한 명에게, 살아있는 연락처로 통지된다
    const [, ctx] = mocks.notifyAll.mock.calls[0];
    expect(ctx.escalationStep).toBe(2);
    expect(ctx.assignees).toEqual([
      { name: "김도윤", slackId: "U2", email: "dy@corp.test", phone: "+821012345678" },
    ]);

    // 통지 이력에도 순위와 함께 남는다
    const logRows = mocks.notifLogCreateMany.mock.calls[0][0].data;
    expect(logRows[0]).toMatchObject({
      alertId: "a1",
      channel: "slack",
      ok: true,
      target: "김도윤",
      escalationStep: 2,
    });
  });

  it("아직 창이 안 지난 알람은 건드리지 않는다", async () => {
    mocks.findMany.mockResolvedValue([
      firingAlert({
        ownershipSnapshot: {
          ...firingAlert().ownershipSnapshot,
          capturedAt: minAgo(3).toISOString(),
        },
      }),
    ]);

    const res = await call({ query: "s3cr3t" });
    expect(await res.json()).toMatchObject({ checked: 1, escalated: 0 });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.notifyAll).not.toHaveBeenCalled();
  });

  it("선점에 진 알람은 통지도 이벤트도 남기지 않는다 (겹치는 틱/그 사이 ack)", async () => {
    mocks.findMany.mockResolvedValue([firingAlert()]);
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const res = await call({ query: "s3cr3t" });
    expect(await res.json()).toMatchObject({ checked: 1, escalated: 0 });
    expect(mocks.eventCreate).not.toHaveBeenCalled();
    expect(mocks.notifyAll).not.toHaveBeenCalled();
  });

  it("스냅샷이 없는 알람(미매핑 수신)은 사다리가 없다", async () => {
    mocks.findMany.mockResolvedValue([firingAlert({ ownershipSnapshot: null })]);

    const res = await call({ query: "s3cr3t" });
    expect(await res.json()).toMatchObject({ checked: 1, escalated: 0 });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("연락처가 삭제됐으면 스냅샷의 이름으로라도 기록한다", async () => {
    mocks.findMany.mockResolvedValue([firingAlert()]);
    mocks.contactFindUnique.mockResolvedValue(null);

    await call({ query: "s3cr3t" });

    const [, ctx] = mocks.notifyAll.mock.calls[0];
    expect(ctx.assignees).toEqual([
      { name: "김도윤", slackId: null, email: null, phone: null },
    ]);
  });
});
