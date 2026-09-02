import { afterEach, describe, expect, it, vi } from "vitest";
import {
  refireThrottleMinutesFromEnv,
  shouldThrottleRefire,
} from "@/lib/refire-throttle";

// 재발화 스로틀 (②): 플랩(해소↔재발화 반복)이 전이마다 재페이징하는 것을
// 막는 순수 판정.

const NOW = new Date("2026-09-02T11:20:00Z");

afterEach(() => vi.unstubAllEnvs());

describe("shouldThrottleRefire", () => {
  it("마지막 팬아웃 후 N분 안의 재발화는 스로틀", () => {
    expect(
      shouldThrottleRefire(new Date("2026-09-02T11:15:00Z"), NOW, 10),
    ).toBe(true);
  });

  it("창을 지났거나, 팬아웃 이력이 없거나, 꺼져 있으면 통과", () => {
    expect(
      shouldThrottleRefire(new Date("2026-09-02T11:05:00Z"), NOW, 10),
    ).toBe(false);
    expect(shouldThrottleRefire(null, NOW, 10)).toBe(false);
    expect(
      shouldThrottleRefire(new Date("2026-09-02T11:15:00Z"), NOW, 0),
    ).toBe(false);
  });

  it("시계가 뒤로 간 경우(미래 스탬프)는 통과 — 스로틀이 통지를 영원히 막으면 안 된다", () => {
    expect(
      shouldThrottleRefire(new Date("2026-09-02T12:00:00Z"), NOW, 10),
    ).toBe(false);
  });
});

describe("refireThrottleMinutesFromEnv", () => {
  it("기본 10분, 숫자면 그 값, 0이면 끔, 쓰레기면 기본값", () => {
    vi.stubEnv("REFIRE_THROTTLE_MINUTES", "");
    expect(refireThrottleMinutesFromEnv()).toBe(10);
    vi.stubEnv("REFIRE_THROTTLE_MINUTES", "5");
    expect(refireThrottleMinutesFromEnv()).toBe(5);
    vi.stubEnv("REFIRE_THROTTLE_MINUTES", "0");
    expect(refireThrottleMinutesFromEnv()).toBe(0);
    vi.stubEnv("REFIRE_THROTTLE_MINUTES", "abc");
    expect(refireThrottleMinutesFromEnv()).toBe(10);
  });
});
