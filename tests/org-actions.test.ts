import { beforeEach, describe, expect, it, vi } from "vitest";

// createContactAndAssign (§6.3/6.4 "+ 새 인원 등록" 인라인): 사람 생성과 스코프
// 맨 뒤 배정이 한 번에 일어나고, 소속 선택이 테넌트 격리(고객사 vs 내부)를
// 결정하는지 검증한다.

const mocks = vi.hoisted(() => ({
  contactCreate: vi.fn(),
  assignmentFindFirst: vi.fn(),
  assignmentCreate: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { create: mocks.contactCreate },
    assignment: {
      findFirst: mocks.assignmentFindFirst,
      create: mocks.assignmentCreate,
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { createContactAndAssign } from "@/server/org-actions";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.contactCreate.mockResolvedValue({ id: "new1" });
  mocks.assignmentFindFirst
    .mockResolvedValueOnce(null) // 중복 배정 검사
    .mockResolvedValueOnce({ order: 2 }); // 현재 맨 뒤 순번
  mocks.assignmentCreate.mockResolvedValue({ id: "as1" });
});

describe("createContactAndAssign", () => {
  it("고객사 소속 인원을 만들고 스코프 맨 뒤 순번으로 배정한다", async () => {
    await createContactAndAssign(
      form({
        level: "service",
        scopeId: "svc1",
        customerId: "cust1",
        affiliation: "customer",
        name: "김또깡",
        department: "운영팀",
        back: "/admin/escalation?level=service",
      }),
    );

    expect(mocks.contactCreate.mock.calls[0][0].data).toMatchObject({
      name: "김또깡",
      department: "운영팀",
      customerId: "cust1",
    });
    expect(mocks.assignmentCreate.mock.calls[0][0].data).toEqual({
      contactId: "new1",
      serviceId: "svc1",
      order: 3,
    });
    // 배정 화면과 멤버 관리 양쪽이 갱신된다
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/escalation");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/contacts");
  });

  it("내부(MSP) 소속이면 customerId가 있어도 null로 만든다", async () => {
    await createContactAndAssign(
      form({
        level: "project",
        scopeId: "proj1",
        customerId: "cust1",
        affiliation: "internal",
        name: "최민서",
      }),
    );

    expect(mocks.contactCreate.mock.calls[0][0].data.customerId).toBeNull();
    expect(mocks.assignmentCreate.mock.calls[0][0].data).toMatchObject({
      projectId: "proj1",
      order: 3,
    });
  });

  it("빈 스코프에는 0번(1순위)으로 들어간다", async () => {
    mocks.assignmentFindFirst.mockReset();
    mocks.assignmentFindFirst.mockResolvedValue(null); // 중복도, 기존 행도 없음

    await createContactAndAssign(
      form({
        level: "customer",
        scopeId: "cust1",
        customerId: "cust1",
        affiliation: "customer",
        name: "홍길동",
      }),
    );

    expect(mocks.assignmentCreate.mock.calls[0][0].data.order).toBe(0);
  });

  it("소속 값이 이상하면 사람을 만들기 전에 던진다", async () => {
    await expect(
      createContactAndAssign(
        form({
          level: "service",
          scopeId: "svc1",
          customerId: "cust1",
          affiliation: "other-tenant",
          name: "누군가",
        }),
      ),
    ).rejects.toThrow("bad affiliation");
    expect(mocks.contactCreate).not.toHaveBeenCalled();
  });

  it("레벨 값이 이상해도 사람을 만들기 전에 던진다", async () => {
    await expect(
      createContactAndAssign(
        form({
          level: "galaxy",
          scopeId: "svc1",
          customerId: "cust1",
          affiliation: "customer",
          name: "누군가",
        }),
      ),
    ).rejects.toThrow("bad scope level");
    expect(mocks.contactCreate).not.toHaveBeenCalled();
  });
});
