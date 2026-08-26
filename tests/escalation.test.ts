import { describe, expect, it } from "vitest";
import {
  ackMinutesFromEnv,
  DEFAULT_ACK_MINUTES,
  nextEscalation,
  type EscalationCandidate,
} from "@/lib/escalation";

// 시간 기반 자동 에스컬레이션의 판정 규칙 (Phase 3): FIRING인 채로 N분 미ack면
// 스냅샷 순서의 다음 사람. cron 라우트는 이 함수의 답만 실행한다.

const T0 = new Date("2026-08-26T10:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function cand(overrides: Partial<EscalationCandidate> = {}): EscalationCandidate {
  return {
    status: "FIRING",
    escalationStep: 1,
    escalatedAt: null,
    firedAt: T0.toISOString(),
    orderLength: 3,
    ...overrides,
  };
}

describe("nextEscalation", () => {
  it("발화 후 N분 미ack이면 2순위(index 1) 차례다", () => {
    expect(nextEscalation(cand(), at(9), 10)).toBeNull();
    expect(nextEscalation(cand(), at(10), 10)).toBe(1);
    expect(nextEscalation(cand(), at(45), 10)).toBe(1);
  });

  it("에스컬레이션 후에는 시계가 다시 시작된다 (escalatedAt 기준)", () => {
    const c = cand({ escalationStep: 2, escalatedAt: at(10) });
    expect(nextEscalation(c, at(15), 10)).toBeNull(); // 2순위에게 준 지 5분
    expect(nextEscalation(c, at(20), 10)).toBe(2); // 10분 지남 → 3순위
  });

  it("사다리를 다 걸었으면 멈춘다 — 1인 리스트는 애초에 대상이 아니다", () => {
    expect(nextEscalation(cand({ escalationStep: 3 }), at(60), 10)).toBeNull();
    expect(nextEscalation(cand({ orderLength: 1 }), at(60), 10)).toBeNull();
    expect(nextEscalation(cand({ orderLength: 0 }), at(60), 10)).toBeNull();
  });

  it("FIRING이 아니면(ack/resolve됨) 어떤 시점에도 대상이 아니다", () => {
    expect(nextEscalation(cand({ status: "ACKNOWLEDGED" }), at(60), 10)).toBeNull();
    expect(nextEscalation(cand({ status: "RESOLVED" }), at(60), 10)).toBeNull();
  });

  it("시간 기준이 없거나 깨졌으면 판정하지 않는다", () => {
    expect(nextEscalation(cand({ firedAt: null }), at(60), 10)).toBeNull();
    expect(nextEscalation(cand({ firedAt: "not-a-date" }), at(60), 10)).toBeNull();
  });

  it("escalationStep이 망가져 있으면(0 이하) 건드리지 않는다", () => {
    expect(nextEscalation(cand({ escalationStep: 0 }), at(60), 10)).toBeNull();
  });
});

describe("ackMinutesFromEnv", () => {
  it("정상 값은 그대로, 빈 값·쓰레기·0 이하는 기본값", () => {
    expect(ackMinutesFromEnv("5")).toBe(5);
    expect(ackMinutesFromEnv(undefined)).toBe(DEFAULT_ACK_MINUTES);
    expect(ackMinutesFromEnv("")).toBe(DEFAULT_ACK_MINUTES);
    expect(ackMinutesFromEnv("abc")).toBe(DEFAULT_ACK_MINUTES);
    expect(ackMinutesFromEnv("0")).toBe(DEFAULT_ACK_MINUTES);
    expect(ackMinutesFromEnv("-3")).toBe(DEFAULT_ACK_MINUTES);
  });
});
