import { beforeEach, describe, expect, it, vi } from "vitest";

// Ack/Resolve 서버 액션 (Phase 2c). 전이 규칙과 이벤트 append만 검증한다 —
// 렌더링은 상세 페이지의 disabled 로직이 담당하고, 여기의 가드는 stale 탭이
// 보낸 불법 전이를 no-op으로 흡수하는 마지막 방어선이다.

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  eventCreate: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    alert: { updateMany: mocks.updateMany },
    alertEvent: { create: mocks.eventCreate },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { ackAlert, resolveAlert } from "@/server/alert-actions";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eventCreate.mockResolvedValue({ id: "ev1" });
});

describe("ackAlert", () => {
  it("FIRING에서만 전이하고, 전이를 AlertEvent로 append한다", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await ackAlert(form({ id: "a1" }));

    const call = mocks.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "a1", status: { in: ["FIRING"] } });
    expect(call.data).toEqual({ status: "ACKNOWLEDGED" });
    expect(mocks.eventCreate).toHaveBeenCalledOnce();
    expect(mocks.eventCreate.mock.calls[0][0].data).toMatchObject({
      alertId: "a1",
      status: "ACKNOWLEDGED",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/alerts/a1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("이미 ACK/RESOLVED면 no-op — 이벤트도 남기지 않는다 (중복 제출 방어)", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await ackAlert(form({ id: "a1" }));

    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });

  it("id가 없으면 던진다", async () => {
    await expect(ackAlert(form({}))).rejects.toThrow("missing id");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe("resolveAlert", () => {
  it("FIRING과 ACKNOWLEDGED 양쪽에서 RESOLVED로 전이한다", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await resolveAlert(form({ id: "a1" }));

    const call = mocks.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({
      id: "a1",
      status: { in: ["FIRING", "ACKNOWLEDGED"] },
    });
    expect(call.data).toEqual({ status: "RESOLVED" });
    expect(mocks.eventCreate.mock.calls[0][0].data).toMatchObject({
      alertId: "a1",
      status: "RESOLVED",
    });
  });

  it("이미 RESOLVED면 no-op — 수동 종료의 이중 기록을 막는다", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await resolveAlert(form({ id: "a1" }));

    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });
});
