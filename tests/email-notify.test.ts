import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedAlert } from "@/lib/types";

// 이메일 채널 (Phase 3): 수신자 결정(To=1순위, Cc=나머지)과 발송 조건만
// 검증한다. SMTP 전송 자체는 nodemailer의 일이다.

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: mocks.createTransport },
}));

import { emailNotifier } from "@/lib/notify/email";

function alert(overrides: Partial<NormalizedAlert> = {}): NormalizedAlert {
  return {
    fingerprint: "cw:arn:alarm/db",
    title: "SEV-1 prod-db CPU",
    source: "cloudwatch",
    severity: "SEV-1",
    status: "FIRING",
    resource: "prod-db",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
  mocks.sendMail.mockResolvedValue({ messageId: "m1" });
  vi.stubEnv("SMTP_HOST", "smtp.test.local");
  vi.stubEnv("SMTP_FROM", "alert-hub <alerts@test.local>");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("emailNotifier", () => {
  it("SMTP_HOST/SMTP_FROM이 없으면 isConfigured가 false다", () => {
    expect(emailNotifier.isConfigured()).toBe(true);
    vi.stubEnv("SMTP_HOST", "");
    expect(emailNotifier.isConfigured()).toBe(false);
  });

  it("이메일이 있는 담당이 없으면 조용히 건너뛴다", async () => {
    await emailNotifier.notify(alert(), {
      assignees: [{ name: "최민서", slackId: "U1", email: null }],
    });
    await emailNotifier.notify(alert(), {});
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("To=이메일 있는 1순위, Cc=나머지 — 없는 이메일은 걸러진다", async () => {
    await emailNotifier.notify(alert(), {
      assignees: [
        { name: "최민서", email: "ms@corp.test" },
        { name: "김도윤", email: null },
        { name: "이몽룡", email: "mr@corp.test" },
      ],
    });

    expect(mocks.sendMail).toHaveBeenCalledOnce();
    const mail = mocks.sendMail.mock.calls[0][0];
    expect(mail.to).toBe("ms@corp.test");
    expect(mail.cc).toEqual(["mr@corp.test"]);
    expect(mail.from).toBe("alert-hub <alerts@test.local>");
    expect(mail.subject).toBe("[FIRING] SEV-1 prod-db CPU");
    expect(mail.text).toContain("resource: prod-db");
  });

  it("에스컬레이션 통지는 제목·본문에 순위가 드러난다", async () => {
    await emailNotifier.notify(alert(), {
      assignees: [{ name: "이몽룡", email: "mr@corp.test" }],
      escalationStep: 2,
    });

    const mail = mocks.sendMail.mock.calls[0][0];
    expect(mail.subject).toBe("[에스컬레이션 2순위] SEV-1 prod-db CPU");
    expect(mail.text).toContain("2순위 이몽룡");
    expect(mail.cc).toBeUndefined();
  });

  it("APP_URL이 있으면 상세 딥링크를 싣는다", async () => {
    vi.stubEnv("APP_URL", "https://hub.test.local/");
    await emailNotifier.notify(alert(), {
      alertId: "a1",
      assignees: [{ name: "최민서", email: "ms@corp.test" }],
    });
    expect(mocks.sendMail.mock.calls[0][0].text).toContain(
      "https://hub.test.local/alerts/a1",
    );
  });
});
