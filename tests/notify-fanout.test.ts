import { describe, expect, it, vi } from "vitest";
import { runNotifiers, type Notifier } from "@/lib/notify";
import type { NormalizedAlert } from "@/lib/types";

// 팬아웃 코어: 채널 격리(한 채널의 실패가 다른 채널을 막지 않는다)와
// sent/skipped/failed 결과 보고를 검증한다. 실제 채널 구현은 각자의
// 테스트(slack은 통합적으로, email/twilio는 전용 파일)가 다룬다.

const alert: NormalizedAlert = {
  fingerprint: "f",
  title: "t",
  source: "generic",
  severity: "SEV-3",
  status: "FIRING",
};

function fake(
  name: string,
  impl: () => Promise<"sent" | "skipped">,
  configured = true,
): { notifier: Notifier; notify: ReturnType<typeof vi.fn> } {
  const notify = vi.fn(impl);
  return {
    notifier: { name, isConfigured: () => configured, notify },
    notify,
  };
}

describe("runNotifiers", () => {
  it("한 채널이 던져도 나머지는 발송되고, 결과는 채널별로 보고된다", async () => {
    const slack = fake("slack", async () => "sent");
    const email = fake("email", async () => {
      throw new Error("SMTP 530");
    });
    const twilio = fake("twilio", async () => "skipped");

    const outcomes = await runNotifiers(
      [slack.notifier, email.notifier, twilio.notifier],
      alert,
      {},
    );

    expect(outcomes).toEqual([
      { channel: "slack", status: "sent" },
      { channel: "email", status: "failed", error: "SMTP 530" },
      { channel: "twilio", status: "skipped" },
    ]);
    expect(slack.notify).toHaveBeenCalledOnce();
    expect(twilio.notify).toHaveBeenCalledOnce();
  });

  it("설정 안 된 채널은 호출조차 하지 않는다", async () => {
    const off = fake("email", async () => "sent", false);
    const on = fake("slack", async () => "sent");

    const outcomes = await runNotifiers([off.notifier, on.notifier], alert, {});

    expect(off.notify).not.toHaveBeenCalled();
    expect(outcomes.map((o) => o.channel)).toEqual(["slack"]);
  });
});
