import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedAlert } from "@/lib/types";

// 통지 아웃박스 (신뢰성 트랙 ①): 잡 생성, 인라인 1회 시도, 지수 백오프
// 재시도, 5회 포기, 낙관적 선점, 통지 이력 로그.

const mocks = vi.hoisted(() => ({
  jobCreate: vi.fn(),
  jobFindMany: vi.fn(),
  jobUpdateMany: vi.fn(),
  logCreateMany: vi.fn(),
  configuredChannels: vi.fn(),
  getNotifier: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationJob: {
      create: mocks.jobCreate,
      findMany: mocks.jobFindMany,
      updateMany: mocks.jobUpdateMany,
    },
    notificationLog: { createMany: mocks.logCreateMany },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

vi.mock("@/lib/notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notify")>()),
  configuredChannels: mocks.configuredChannels,
  getNotifier: mocks.getNotifier,
}));

import { drainDueJobs, enqueueAndSend, recordNotifications } from "@/server/notify-queue";

const NOW = new Date("2026-09-02T11:20:00Z");

const ALERT: NormalizedAlert = {
  fingerprint: "cw:arn:alarm/db",
  title: "SEV-1 prod-db CPU",
  source: "cloudwatch",
  severity: "SEV-1",
  status: "FIRING",
};

const CTX = { alertId: "a1", assignees: [{ name: "최민서" }, { name: "김도윤" }] };

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "j1",
    alertId: "a1",
    channel: "slack",
    payload: { alert: ALERT, ctx: CTX },
    status: "pending",
    attempts: 0,
    nextAttemptAt: NOW,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function fakeNotifier(notify: ReturnType<typeof vi.fn>, configured = true) {
  return { name: "slack", isConfigured: () => configured, notify };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
  mocks.jobCreate.mockResolvedValue({ id: "j1" });
  mocks.logCreateMany.mockResolvedValue({ count: 1 });
  mocks.configuredChannels.mockReturnValue(["slack"]);
});

describe("enqueueAndSend", () => {
  it("설정된 채널마다 잡을 만들고 인라인으로 1회 드레인한다", async () => {
    mocks.configuredChannels.mockReturnValue(["slack", "email"]);
    mocks.jobCreate
      .mockResolvedValueOnce({ id: "j1" })
      .mockResolvedValueOnce({ id: "j2" });
    mocks.jobFindMany.mockResolvedValue([]); // 드레인 대상 조회

    await enqueueAndSend("a1", ALERT, CTX);

    expect(mocks.jobCreate).toHaveBeenCalledTimes(2);
    expect(mocks.jobCreate.mock.calls[0][0].data).toMatchObject({
      alertId: "a1",
      channel: "slack",
    });
    // 인라인 드레인은 방금 만든 잡 id로 제한된다
    const where = mocks.jobFindMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ in: ["j1", "j2"] });
  });

  it("설정된 채널이 없으면 아무것도 만들지 않는다 (no-op)", async () => {
    mocks.configuredChannels.mockReturnValue([]);
    await enqueueAndSend("a1", ALERT, CTX);
    expect(mocks.jobCreate).not.toHaveBeenCalled();
  });

  it("큐 조작이 죽어도 던지지 않는다 — ingest를 죽이면 본말전도", async () => {
    mocks.jobCreate.mockRejectedValue(new Error("db down"));
    await expect(enqueueAndSend("a1", ALERT, CTX)).resolves.toBeUndefined();
  });
});

describe("drainDueJobs — 발송과 재시도", () => {
  it("성공: 잡은 sent, 통지 이력에 ok=true + 대상 이름이 남는다", async () => {
    const notify = vi.fn().mockResolvedValue("sent");
    mocks.getNotifier.mockReturnValue(fakeNotifier(notify));
    mocks.jobFindMany.mockResolvedValue([job()]);

    const result = await drainDueJobs(NOW);

    expect(result).toMatchObject({ due: 1, sent: 1, retrying: 0, gaveUp: 0 });
    expect(notify).toHaveBeenCalledWith(ALERT, CTX);
    // 선점 클레임: attempts 0 → 1, 다음 시도 시각은 30초 뒤로 미리 적어 둔다
    const claim = mocks.jobUpdateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: "j1", status: "pending", attempts: 0 });
    expect(claim.data.attempts).toBe(1);
    expect(claim.data.nextAttemptAt).toEqual(new Date(NOW.getTime() + 30_000));
    // 상태 확정
    expect(mocks.jobUpdateMany.mock.calls[1][0].data.status).toBe("sent");
    const rows = mocks.logCreateMany.mock.calls[0][0].data;
    expect(rows[0]).toMatchObject({
      alertId: "a1",
      channel: "slack",
      ok: true,
      target: "최민서 외 1명",
    });
  });

  it("실패: pending 유지 + lastError, 로그는 아직 없다 (재시도 예정)", async () => {
    const notify = vi.fn().mockRejectedValue(new Error("rate_limited"));
    mocks.getNotifier.mockReturnValue(fakeNotifier(notify));
    mocks.jobFindMany.mockResolvedValue([job()]);

    const result = await drainDueJobs(NOW);

    expect(result).toMatchObject({ retrying: 1, gaveUp: 0, sent: 0 });
    const last = mocks.jobUpdateMany.mock.calls.at(-1)![0];
    expect(last.data).toMatchObject({ lastError: "rate_limited" });
    expect(last.data.status).toBeUndefined(); // pending 그대로
    expect(mocks.logCreateMany).not.toHaveBeenCalled();
  });

  it("백오프 사다리: 2번째 시도 실패 후 다음 시각은 1분 뒤", async () => {
    const notify = vi.fn().mockRejectedValue(new Error("boom"));
    mocks.getNotifier.mockReturnValue(fakeNotifier(notify));
    mocks.jobFindMany.mockResolvedValue([job({ attempts: 1 })]);

    await drainDueJobs(NOW);

    const claim = mocks.jobUpdateMany.mock.calls[0][0];
    expect(claim.data.attempts).toBe(2);
    expect(claim.data.nextAttemptAt).toEqual(new Date(NOW.getTime() + 60_000));
  });

  it("5번째 실패는 포기 — failed + 로그 ok=false '5회 실패, 포기'", async () => {
    const notify = vi.fn().mockRejectedValue(new Error("SMTP 550"));
    mocks.getNotifier.mockReturnValue(fakeNotifier(notify));
    mocks.jobFindMany.mockResolvedValue([job({ attempts: 4 })]);

    const result = await drainDueJobs(NOW);

    expect(result).toMatchObject({ gaveUp: 1 });
    const final = mocks.jobUpdateMany.mock.calls.at(-1)![0];
    expect(final.data).toMatchObject({ status: "failed", lastError: "SMTP 550" });
    const rows = mocks.logCreateMany.mock.calls[0][0].data;
    expect(rows[0].ok).toBe(false);
    expect(rows[0].error).toContain("5회 실패, 포기");
  });

  it("skipped(수신자 없음)는 skipped로 닫고 로그를 남기지 않는다", async () => {
    const notify = vi.fn().mockResolvedValue("skipped");
    mocks.getNotifier.mockReturnValue(fakeNotifier(notify));
    mocks.jobFindMany.mockResolvedValue([job()]);

    await drainDueJobs(NOW);

    expect(mocks.jobUpdateMany.mock.calls.at(-1)![0].data.status).toBe("skipped");
    expect(mocks.logCreateMany).not.toHaveBeenCalled();
  });

  it("선점에 지면(겹치는 틱) 발송하지 않는다", async () => {
    const notify = vi.fn();
    mocks.getNotifier.mockReturnValue(fakeNotifier(notify));
    mocks.jobFindMany.mockResolvedValue([job()]);
    mocks.jobUpdateMany.mockResolvedValueOnce({ count: 0 }); // 클레임 실패

    const result = await drainDueJobs(NOW);

    expect(notify).not.toHaveBeenCalled();
    expect(result).toMatchObject({ due: 1, sent: 0, retrying: 0, gaveUp: 0 });
  });

  it("채널 설정이 사라졌으면 즉시 포기로 남긴다 — 재시도 무의미", async () => {
    mocks.getNotifier.mockReturnValue(undefined);
    mocks.jobFindMany.mockResolvedValue([job()]);

    const result = await drainDueJobs(NOW);

    expect(result).toMatchObject({ gaveUp: 1 });
    const rows = mocks.logCreateMany.mock.calls[0][0].data;
    expect(rows[0].error).toContain("채널 미설정");
  });
});

describe("recordNotifications", () => {
  it("로그 기록 실패는 삼킨다", async () => {
    mocks.logCreateMany.mockRejectedValue(new Error("db down"));
    await expect(
      recordNotifications("a1", CTX, [{ channel: "slack", status: "sent" }]),
    ).resolves.toBeUndefined();
  });
});
