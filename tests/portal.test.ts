import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeGrants, formatGrants, hasGrant, parseGrants } from "@/lib/portal";

// 고객사 포털 권한 — 기본은 읽기 전용, MSP 가 고객사마다 항목별로 쓰기를 켠다.
// 그리고 남의 회사 id 로 들어온 요청은 소유 검사에서 막힌다(위조 요청 방어).

describe("권한 파싱", () => {
  it("쉼표 목록을 읽고, 모르는 키는 버리고, 순서를 고정한다", () => {
    expect(parseGrants("silences, contacts")).toEqual(["contacts", "silences"]);
    expect(parseGrants("contacts,contacts")).toEqual(["contacts"]);
    expect(parseGrants("admin,drop-table,channels")).toEqual(["channels"]);
    expect(parseGrants(null)).toEqual([]);
  });
  it("저장 형태로 되돌리고, 비면 null", () => {
    expect(formatGrants(["silences", "contacts"])).toBe("contacts,silences");
    expect(formatGrants([])).toBeNull();
  });
  it("판정과 사람이 읽는 요약", () => {
    expect(hasGrant("contacts,channels", "channels")).toBe(true);
    expect(hasGrant("contacts", "channels")).toBe(false);
    expect(hasGrant(null, "contacts")).toBe(false);
    expect(describeGrants("channels,contacts")).toBe("담당자 관리 · Slack 채널 관리");
    expect(describeGrants(null)).toBe("읽기 전용");
  });
});

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  customerFindUnique: vi.fn(),
  contactFindUnique: vi.fn(),
  silenceFindUnique: vi.fn(),
  channelFindUnique: vi.fn(),
  projectFindUnique: vi.fn(),
  serviceFindUnique: vi.fn(),
  auditCreate: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findUnique: mocks.customerFindUnique },
    contact: { findUnique: mocks.contactFindUnique },
    silence: { findUnique: mocks.silenceFindUnique },
    notifyChannel: { findUnique: mocks.channelFindUnique },
    project: { findUnique: mocks.projectFindUnique },
    service: { findUnique: mocks.serviceFindUnique },
    auditLog: { create: mocks.auditCreate },
  },
}));
vi.mock("@/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth")>()),
  getCurrentUser: mocks.getCurrentUser,
}));

import {
  assertOwnedChannel,
  assertOwnedContact,
  assertOwnedScope,
  assertOwnedSilence,
  requirePortal,
} from "@/server/portal";

const MINE = "cu-mine";
const OTHER = "cu-other";
const customerAccount = { id: "c1", name: "홈닉담당", email: "a@homenic.co.kr", status: "ACTIVE", customerId: MINE };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(customerAccount);
  mocks.customerFindUnique.mockResolvedValue({
    id: MINE,
    name: "홈닉",
    portalGrants: "contacts,silences",
    loginDomains: "homenic.co.kr",
  });
});

describe("① 고객사 계정 + ② 권한", () => {
  it("권한이 켜진 항목은 통과하고 고객사 정보를 돌려준다", async () => {
    const ctx = await requirePortal("contacts");
    expect(ctx).toMatchObject({ customerId: MINE, customerName: "홈닉", grants: ["contacts", "silences"] });
  });

  it("켜지지 않은 항목은 거부 — 폼이 없어도 액션이 막는다", async () => {
    await expect(requirePortal("channels")).rejects.toThrow("읽기 전용");
  });

  it("내부 인원(관리자 포함)은 포털 액션을 쓸 수 없다", async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...customerAccount, customerId: null, role: "ADMIN" });
    await expect(requirePortal("contacts")).rejects.toThrow("고객사 담당자 계정만");
  });

  it("로그인 도메인이 꺼진 고객사는 세션이 남아 있어도 거부", async () => {
    mocks.customerFindUnique.mockResolvedValue({ id: MINE, name: "홈닉", portalGrants: "contacts", loginDomains: null });
    await expect(requirePortal("contacts")).rejects.toThrow("로그인이 꺼져");
  });

  it("로그인하지 않았으면 거부", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(requirePortal()).rejects.toThrow("로그인이 필요합니다");
  });
});

describe("③ 소유 검사 — 위조한 id 로 남의 회사를 만질 수 없다", () => {
  it("담당자: 남의 회사 소속이면 거부", async () => {
    mocks.contactFindUnique.mockResolvedValue({ customerId: OTHER, name: "남의회사 담당" });
    await expect(assertOwnedContact(MINE, "x")).rejects.toThrow("우리 회사의 항목이 아닙니다");
    mocks.contactFindUnique.mockResolvedValue({ customerId: MINE, name: "우리 담당" });
    expect(await assertOwnedContact(MINE, "x")).toEqual({ name: "우리 담당" });
  });

  it("담당자: 없는 id 도 같은 거부 (존재 여부를 알려주지 않는다)", async () => {
    mocks.contactFindUnique.mockResolvedValue(null);
    await expect(assertOwnedContact(MINE, "ghost")).rejects.toThrow("우리 회사의 항목이 아닙니다");
  });

  it("점검 창: 고객사 · 프로젝트 · 서비스 · 알람 어느 경로로 달렸든 주인을 따라간다", async () => {
    mocks.silenceFindUnique.mockResolvedValue({ reason: "r", customerId: null, project: null, service: { project: { customerId: MINE } }, alert: null });
    expect(await assertOwnedSilence(MINE, "s")).toEqual({ reason: "r" });
    mocks.silenceFindUnique.mockResolvedValue({ reason: "r", customerId: null, project: { customerId: OTHER }, service: null, alert: null });
    await expect(assertOwnedSilence(MINE, "s")).rejects.toThrow("우리 회사의 항목이 아닙니다");
    mocks.silenceFindUnique.mockResolvedValue({ reason: "r", customerId: null, project: null, service: null, alert: { customerId: MINE } });
    expect(await assertOwnedSilence(MINE, "s")).toEqual({ reason: "r" });
  });

  it("채널: 남의 회사 프로젝트에 붙은 채널은 거부", async () => {
    mocks.channelFindUnique.mockResolvedValue({ label: "L", customerId: null, project: { customerId: OTHER }, service: null });
    await expect(assertOwnedChannel(MINE, "ch")).rejects.toThrow("우리 회사의 항목이 아닙니다");
    mocks.channelFindUnique.mockResolvedValue({ label: "L", customerId: MINE, project: null, service: null });
    expect(await assertOwnedChannel(MINE, "ch")).toEqual({ label: "L" });
  });

  it("범위: 남의 고객사 id·프로젝트·서비스는 전부 거부, 내 것은 where 조각으로", async () => {
    await expect(assertOwnedScope(MINE, "customer", OTHER)).rejects.toThrow("우리 회사의 항목이 아닙니다");
    expect(await assertOwnedScope(MINE, "customer", MINE)).toEqual({ customerId: MINE });

    mocks.projectFindUnique.mockResolvedValue({ customerId: OTHER });
    await expect(assertOwnedScope(MINE, "project", "p1")).rejects.toThrow("우리 회사의 항목이 아닙니다");
    mocks.projectFindUnique.mockResolvedValue({ customerId: MINE });
    expect(await assertOwnedScope(MINE, "project", "p1")).toEqual({ projectId: "p1" });

    mocks.serviceFindUnique.mockResolvedValue({ project: { customerId: OTHER } });
    await expect(assertOwnedScope(MINE, "service", "s1")).rejects.toThrow("우리 회사의 항목이 아닙니다");
    mocks.serviceFindUnique.mockResolvedValue({ project: { customerId: MINE } });
    expect(await assertOwnedScope(MINE, "service", "s1")).toEqual({ serviceId: "s1" });

    await expect(assertOwnedScope(MINE, "account", "a1")).rejects.toThrow("범위가 잘못됐습니다");
  });
});
