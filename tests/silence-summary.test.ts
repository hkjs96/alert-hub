import { beforeEach, describe, expect, it, vi } from "vitest";

// 점검 종료 요약 (v2 프레임 05 우측): 정확히 한 번(summaryAt 선점), 수치
// 집계, 실패 시 되돌려 재시도, 남은 FIRING 통지 재개.

const mocks = vi.hoisted(() => ({
  silenceFindMany: vi.fn(),
  silenceUpdateMany: vi.fn(),
  eventFindMany: vi.fn(),
  alertFindMany: vi.fn(),
  sendSlackText: vi.fn(),
  refire: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    silence: { findMany: mocks.silenceFindMany, updateMany: mocks.silenceUpdateMany },
    alertEvent: { findMany: mocks.eventFindMany },
    alert: { findMany: mocks.alertFindMany },
  },
}));

vi.mock("@/lib/notify/slack", () => ({ sendSlackText: mocks.sendSlackText }));
vi.mock("@/server/alerts", () => ({ refireNotifications: mocks.refire }));

import { summarizeEndedSilences } from "@/server/silence-summary";

const NOW = new Date("2026-09-02T23:05:00Z");

function endedWindow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sil1",
    alertId: null,
    customerId: null,
    projectId: null,
    serviceId: "svc1",
    startsAt: new Date("2026-09-02T09:00:00Z"),
    endsAt: new Date("2026-09-02T23:00:00Z"),
    reason: "인증 서버 이중화 작업 (CHG-2418)",
    createdBy: "최민서",
    revokedAt: null,
    summaryAt: null,
    createdAt: new Date("2026-09-02T08:00:00Z"),
    customer: null,
    project: null,
    service: {
      name: "로그인서비스",
      project: { name: "커머스", customer: { name: "카카오뱅크" } },
    },
    ...overrides,
  };
}

function firingAlert(id: string, title: string) {
  return {
    id,
    fingerprint: `fp-${id}`,
    title,
    description: null,
    source: "cloudwatch",
    severity: "SEV-2",
    status: "FIRING",
    resource: null,
    metric: null,
    namespace: null,
    value: null,
    threshold: null,
    comparison: null,
    region: null,
    accountId: "210987654321",
    stateReason: null,
    count: 8,
    lastSeenAt: NOW,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.silenceFindMany.mockResolvedValue([]);
  mocks.silenceUpdateMany.mockResolvedValue({ count: 1 });
  mocks.eventFindMany.mockResolvedValue([]);
  mocks.alertFindMany.mockResolvedValue([]);
  mocks.sendSlackText.mockResolvedValue("sent");
});

describe("summarizeEndedSilences", () => {
  it("종료된 서비스 점검 창의 요약을 보낸다 — 발생/남은/자동 해소 + 재개", async () => {
    mocks.silenceFindMany.mockResolvedValue([endedWindow()]);
    // 창 동안 7건 발화 (알람 6개, 하나는 중복 발화)
    mocks.eventFindMany.mockResolvedValue(
      ["a1", "a2", "a3", "a4", "a5", "a6", "a1"].map((alertId) => ({ alertId })),
    );
    const remaining = [firingAlert("a1", "login-svc 인증 실패율 상승")];
    mocks.alertFindMany.mockResolvedValue(remaining);

    const sent = await summarizeEndedSilences(NOW);

    expect(sent).toBe(1);
    const text = mocks.sendSlackText.mock.calls[0][0];
    expect(text).toContain("점검 창 종료 — 로그인서비스");
    expect(text).toContain("카카오뱅크 › 커머스 › 로그인서비스");
    expect(text).toContain("뮤트 중 발생 *6*");
    expect(text).toContain("남은 FIRING *1*");
    expect(text).toContain("자동 해소 *5*");
    expect(text).toContain("login-svc 인증 실패율 상승");
    expect(text).toContain("뮤트 중 발화한 1건은 즉시 발송");
    // 창 안에서 발화한 남은 FIRING의 통지가 재개된다
    expect(mocks.refire).toHaveBeenCalledOnce();
    expect(mocks.refire.mock.calls[0][0].id).toBe("a1");
    // 스코프 필터는 스냅샷 체인 serviceId 기준
    expect(mocks.alertFindMany.mock.calls[0][0].where.ownershipSnapshot).toEqual({
      path: ["chain", "serviceId"],
      equals: "svc1",
    });
  });

  it("선점에 지면(겹치는 틱) 아무것도 보내지 않는다", async () => {
    mocks.silenceFindMany.mockResolvedValue([endedWindow()]);
    mocks.silenceUpdateMany.mockResolvedValue({ count: 0 });

    expect(await summarizeEndedSilences(NOW)).toBe(0);
    expect(mocks.sendSlackText).not.toHaveBeenCalled();
  });

  it("발송 실패면 summaryAt을 되돌려 다음 틱이 재시도한다", async () => {
    mocks.silenceFindMany.mockResolvedValue([endedWindow()]);
    mocks.sendSlackText.mockRejectedValue(new Error("slack down"));

    expect(await summarizeEndedSilences(NOW)).toBe(0);

    const revert = mocks.silenceUpdateMany.mock.calls.at(-1)![0];
    expect(revert.data).toEqual({ summaryAt: null });
  });

  it("알람 단위 뮤트는 요약 없이 마감한다", async () => {
    mocks.silenceFindMany.mockResolvedValue([
      endedWindow({ serviceId: null, service: null, alertId: "a1" }),
    ]);

    expect(await summarizeEndedSilences(NOW)).toBe(0);
    expect(mocks.sendSlackText).not.toHaveBeenCalled();
    // 그래도 summaryAt은 찍혀 다시 스캔되지 않는다
    expect(mocks.silenceUpdateMany).toHaveBeenCalledOnce();
  });

  it("시작 전에 취소된 예약 창은 요약 대상이 아니다", async () => {
    mocks.silenceFindMany.mockResolvedValue([
      endedWindow({
        startsAt: new Date("2026-09-03T17:00:00Z"),
        endsAt: new Date("2026-09-03T19:00:00Z"),
        revokedAt: NOW,
      }),
    ]);

    expect(await summarizeEndedSilences(NOW)).toBe(0);
    expect(mocks.sendSlackText).not.toHaveBeenCalled();
  });
});

describe("재개(즉시 발송) 대상의 경계", () => {
  it("창 밖에서 이미 통지된 FIRING은 재발송하지 않는다 (중복 페이징 금지)", async () => {
    mocks.silenceFindMany.mockResolvedValue([endedWindow()]);
    // 창 동안 발화한 건 a1뿐인데, a2는 창 이전부터 FIRING이었다.
    mocks.eventFindMany.mockResolvedValue([{ alertId: "a1" }]);
    mocks.alertFindMany.mockResolvedValue([
      firingAlert("a1", "창 안에서 발화"),
      firingAlert("a2", "창 이전부터 FIRING — 이미 통지됨"),
    ]);

    await summarizeEndedSilences(NOW);

    expect(mocks.refire).toHaveBeenCalledOnce();
    expect(mocks.refire.mock.calls[0][0].id).toBe("a1");
    const text = mocks.sendSlackText.mock.calls[0][0];
    expect(text).toContain("남은 FIRING *2*");
    expect(text).toContain("뮤트 중 발화한 1건은 즉시 발송");
  });
});
