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
  it("처음 보는 이메일은 내부 인원으로 만들되 승인 대기(PENDING)로 시작한다", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "new1", status: "PENDING", onboardedAt: null });
    const r = await provisionInternalContact({ email: "kim@msp.co.kr", name: "김도윤", now: NOW });
    expect(r).toEqual({ ok: true, contactId: "new1", created: true, status: "PENDING", onboarded: false });
    expect(mocks.create).toHaveBeenCalledWith({
      data: { name: "김도윤", email: "kim@msp.co.kr", customerId: null, lastLoginAt: NOW, role: "OPERATOR", status: "PENDING" },
    });
  });

  it("AUTH_BOOTSTRAP_ADMINS 에 있는 이메일은 첫 로그인에 바로 ADMIN·활성", async () => {
    process.env.AUTH_BOOTSTRAP_ADMINS = "JSmini3814@gmail.com";
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "adm", status: "ACTIVE", onboardedAt: null });
    const r = await provisionInternalContact({ email: "jsmini3814@gmail.com", name: "관리자", now: NOW });
    expect(r).toMatchObject({ ok: true, status: "ACTIVE", created: true });
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ role: "ADMIN", status: "ACTIVE", approvedBy: "bootstrap" });
    delete process.env.AUTH_BOOTSTRAP_ADMINS;
  });

  it("이미 PENDING 인 사람이 부트스트랩 목록에 오르면 승격한다", async () => {
    process.env.AUTH_BOOTSTRAP_ADMINS = "a@b.c";
    mocks.findFirst.mockResolvedValue({ id: "c1", customerId: null, active: true, name: "n", status: "PENDING", role: "OPERATOR" });
    mocks.update.mockResolvedValue({ id: "c1", status: "ACTIVE", onboardedAt: null });
    const r = await provisionInternalContact({ email: "a@b.c", name: "n", now: NOW });
    expect(r).toMatchObject({ ok: true, status: "ACTIVE", created: false });
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ role: "ADMIN", status: "ACTIVE" });
    delete process.env.AUTH_BOOTSTRAP_ADMINS;
  });

  it("관리자가 미리 등록한(ACTIVE) 내부 인원은 그 행에 붙고 로그인 시각만 갱신 = 초대", async () => {
    mocks.findFirst.mockResolvedValue({ id: "c1", customerId: null, active: true, name: "관리자가 적은 이름", status: "ACTIVE", role: "OPERATOR", onboardedAt: NOW });
    mocks.update.mockResolvedValue({ id: "c1", status: "ACTIVE", onboardedAt: NOW });
    const r = await provisionInternalContact({ email: "Kim@MSP.co.kr", name: "구글이름", now: NOW });
    expect(r).toEqual({ ok: true, contactId: "c1", created: false, status: "ACTIVE", onboarded: true });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { lastLoginAt: NOW } });
    // 조회는 대소문자 무시
    expect(mocks.findFirst.mock.calls[0][0].where.email).toEqual({ equals: "Kim@MSP.co.kr", mode: "insensitive" });
  });

  it("거절된 계정은 다시 들어올 수 없다", async () => {
    mocks.findFirst.mockResolvedValue({ id: "c1", customerId: null, active: true, name: "n", status: "REJECTED", role: "OPERATOR" });
    const r = await provisionInternalContact({ email: "x@msp.co.kr", name: "n" });
    expect(r).toEqual({ ok: false, reason: "rejected" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("이름이 비어 있던 행은 Google 이름으로 채운다", async () => {
    mocks.findFirst.mockResolvedValue({ id: "c1", customerId: null, active: true, name: "  ", status: "ACTIVE", role: "OPERATOR" });
    mocks.update.mockResolvedValue({ id: "c1", status: "ACTIVE", onboardedAt: null });
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
    mocks.findFirst.mockResolvedValue({ id: "c1", customerId: null, active: false, name: "퇴사자", status: "ACTIVE", role: "OPERATOR" });
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
    const base = { id: "c1", customerId: null, name: "n", email: "a@x.com", department: null, slackId: null, phone: null, role: "OPERATOR", status: "ACTIVE", onboardedAt: null, timezone: null, createdAt: NOW, approvalPingAt: null };
    mocks.findUnique.mockResolvedValue({ ...base, active: false });
    expect(await getCurrentUser()).toBeNull();
    // 거절된 계정도 즉시 차단
    mocks.findUnique.mockResolvedValue({ ...base, active: true, status: "REJECTED" });
    expect(await getCurrentUser()).toBeNull();

    mocks.findUnique.mockResolvedValue({ ...base, active: true, slackId: "U1" });
    const me = await getCurrentUser();
    expect(me?.id).toBe("c1");
    expect(me?.role).toBe("OPERATOR");
    expect(me?.profileIncomplete).toBe(false);
    expect(me?.sessionExp).toBeGreaterThan(0);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.AUTH_SECRET;
  });
});

describe("requireRole", () => {
  it("SSO가 열린(open) 모드면 통과, SSO 모드에서 역할 부족이면 throw", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.AUTH_SECRET;
    const { requireRole, AuthError } = await import("@/server/auth");
    expect(await requireRole("ADMIN")).toBeNull();

    process.env.GOOGLE_CLIENT_ID = "x";
    process.env.GOOGLE_CLIENT_SECRET = "y";
    process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
    const { signSession } = await import("@/lib/auth/session");
    const token = await signSession({ sub: "c1", email: "a@x.com", name: "n" }, process.env.AUTH_SECRET);
    mocks.cookies.mockReturnValue({ get: () => ({ value: token }) } as never);
    const base = { id: "c1", customerId: null, active: true, name: "n", email: "a@x.com", department: null, slackId: null, phone: null, status: "ACTIVE", onboardedAt: null, timezone: null, createdAt: NOW, approvalPingAt: null };
    mocks.findUnique.mockResolvedValue({ ...base, role: "OPERATOR" });
    await expect(requireRole("ADMIN")).rejects.toBeInstanceOf(AuthError);
    expect((await requireRole("OPERATOR"))?.id).toBe("c1");
    // 승인 대기는 어떤 역할도 못 쓴다
    mocks.findUnique.mockResolvedValue({ ...base, role: "ADMIN", status: "PENDING" });
    await expect(requireRole("VIEWER")).rejects.toBeInstanceOf(AuthError);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.AUTH_SECRET;
  });
});
