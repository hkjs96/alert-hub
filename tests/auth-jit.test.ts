import { beforeEach, describe, expect, it, vi } from "vitest";

// JIT 프로비저닝: SSO 첫 로그인이 내부 인원을 만들거나 기존 행에 붙는지,
// 고객사 담당자·비활성 인원은 거부되는지.

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  findUnique: vi.fn(),
  cookies: vi.fn(() => ({ get: () => undefined })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findFirst: mocks.findFirst,
      update: mocks.update,
      create: mocks.create,
      findUnique: mocks.findUnique,
    },
  },
}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import { getCurrentUser, provisionInternalContact } from "@/server/auth";

const NOW = new Date("2026-09-03T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({});
});

describe("SSO 첫 로그인 → 내부 인원 JIT", () => {
  it("이메일이 없으면 내부 인원(customerId=null)으로 만든다", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "new1" });
    const r = await provisionInternalContact({ email: "kim@msp.co.kr", name: "김도윤", now: NOW });
    expect(r).toEqual({ ok: true, contactId: "new1", created: true });
    expect(mocks.create).toHaveBeenCalledWith({
      data: { name: "김도윤", email: "kim@msp.co.kr", customerId: null, lastLoginAt: NOW },
    });
  });

  it("같은 이메일의 내부 인원이 있으면 그 행에 붙고 로그인 시각만 갱신 (이름은 유지)", async () => {
    mocks.findFirst.mockResolvedValue({ id: "c1", customerId: null, active: true, name: "관리자가 적은 이름" });
    const r = await provisionInternalContact({ email: "Kim@MSP.co.kr", name: "구글이름", now: NOW });
    expect(r).toEqual({ ok: true, contactId: "c1", created: false });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { lastLoginAt: NOW } });
    // 조회는 대소문자 무시
    expect(mocks.findFirst.mock.calls[0][0].where.email).toEqual({ equals: "Kim@MSP.co.kr", mode: "insensitive" });
  });

  it("이름이 비어 있던 행은 Google 이름으로 채운다", async () => {
    mocks.findFirst.mockResolvedValue({ id: "c1", customerId: null, active: true, name: "  " });
    await provisionInternalContact({ email: "kim@msp.co.kr", name: "김도윤", now: NOW });
    expect(mocks.update.mock.calls[0][0].data).toEqual({ lastLoginAt: NOW, name: "김도윤" });
  });

  it("고객사 담당자 이메일은 거부 — 고객사 사람은 로그인 대상이 아니다", async () => {
    mocks.findFirst.mockResolvedValue({ id: "cust1", customerId: "cu1", active: true, name: "최민서" });
    const r = await provisionInternalContact({ email: "mschoi@neowiz.example", name: "최민서" });
    expect(r).toEqual({ ok: false, reason: "customer" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("비활성 인원은 거부하고 아무것도 바꾸지 않는다", async () => {
    mocks.findFirst.mockResolvedValue({ id: "c1", customerId: null, active: false, name: "퇴사자" });
    const r = await provisionInternalContact({ email: "gone@msp.co.kr", name: "퇴사자" });
    expect(r).toEqual({ ok: false, reason: "inactive" });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("getCurrentUser", () => {
  it("SSO가 꺼져 있으면 쿠키와 무관하게 null", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.AUTH_SECRET;
    expect(await getCurrentUser()).toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("세션은 유효해도 비활성으로 바뀐 사람은 null — 즉시 차단", async () => {
    process.env.GOOGLE_CLIENT_ID = "x";
    process.env.GOOGLE_CLIENT_SECRET = "y";
    process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
    const { signSession } = await import("@/lib/auth/session");
    const token = await signSession({ sub: "c1", email: "a@x.com", name: "n" }, process.env.AUTH_SECRET);
    mocks.cookies.mockReturnValue({ get: () => ({ value: token }) } as never);
    mocks.findUnique.mockResolvedValue({ id: "c1", active: false, customerId: null, name: "n", email: "a@x.com", department: null, slackId: null, phone: null });
    expect(await getCurrentUser()).toBeNull();

    mocks.findUnique.mockResolvedValue({ id: "c1", active: true, customerId: null, name: "n", email: "a@x.com", department: null, slackId: "U1", phone: null });
    const me = await getCurrentUser();
    expect(me?.id).toBe("c1");
    expect(me?.profileIncomplete).toBe(false);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.AUTH_SECRET;
  });
});
