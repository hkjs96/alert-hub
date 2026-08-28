import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedAlert } from "@/lib/types";
import { twilioNotifier } from "@/lib/notify/twilio";

// 전화/SMS 채널 (Phase 3 마지막 단): "에스컬레이션에만, 대상 한 명에게,
// 번호가 있을 때만"이라는 발동 조건과 REST 호출 형태를 검증한다.

const fetchMock = vi.fn();

function alert(overrides: Partial<NormalizedAlert> = {}): NormalizedAlert {
  return {
    fingerprint: "cw:arn:alarm/db",
    title: "SEV-1 prod-db CPU",
    source: "cloudwatch",
    severity: "SEV-1",
    status: "FIRING",
    ...overrides,
  };
}

const target = { name: "김도윤", phone: "+821012345678" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ ok: true });
  vi.stubEnv("TWILIO_ACCOUNT_SID", "ACxxxx");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
  vi.stubEnv("TWILIO_FROM", "+821000000000");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("twilioNotifier", () => {
  it("계정 설정이 없으면 isConfigured가 false다", () => {
    expect(twilioNotifier.isConfigured()).toBe(true);
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    expect(twilioNotifier.isConfigured()).toBe(false);
  });

  it("최초 FIRING 팬아웃에는 침묵한다 — 에스컬레이션 전용 채널", async () => {
    await twilioNotifier.notify(alert(), { assignees: [target] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("번호가 없는 대상은 건너뛴다", async () => {
    await twilioNotifier.notify(alert(), {
      assignees: [{ name: "김도윤", phone: null }],
      escalationStep: 2,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("에스컬레이션이면 대상 번호로 SMS를 보낸다 (기본: 전화는 안 건다)", async () => {
    vi.stubEnv("APP_URL", "https://hub.test.local");
    await twilioNotifier.notify(alert(), {
      alertId: "a1",
      assignees: [target],
      escalationStep: 2,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/ACxxxx/Messages.json",
    );
    expect(init.headers.authorization).toBe(
      `Basic ${Buffer.from("ACxxxx:tok").toString("base64")}`,
    );
    const form = new URLSearchParams(init.body);
    expect(form.get("To")).toBe("+821012345678");
    expect(form.get("From")).toBe("+821000000000");
    expect(form.get("Body")).toContain("2순위 에스컬레이션");
    expect(form.get("Body")).toContain("https://hub.test.local/alerts/a1");
  });

  it("TWILIO_VOICE=true면 SMS에 이어 전화도 건다 — TwiML은 XML 이스케이프", async () => {
    vi.stubEnv("TWILIO_VOICE", "true");
    await twilioNotifier.notify(alert({ title: "CPU > 90% <critical>" }), {
      assignees: [target],
      escalationStep: 3,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain("/Calls.json");
    const form = new URLSearchParams(init.body);
    expect(form.get("Twiml")).toContain("&gt; 90% &lt;critical&gt;");
    expect(form.get("Twiml")).toContain("3순위 김도윤");
  });

  it("Twilio가 4xx를 주면 던진다 — notifyAll이 채널별로 격리해 삼킨다", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });
    await expect(
      twilioNotifier.notify(alert(), { assignees: [target], escalationStep: 2 }),
    ).rejects.toThrow("401");
  });
});
