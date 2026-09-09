import { describe, expect, it } from "vitest";
import {
  describeItem,
  describeSummary,
  formatDuration,
  pickPrior,
  priorLine,
  summarize,
  tierOf,
  type ResolutionLite,
} from "@/lib/history";

// 해결 기록(사실 층): 검색 티어, 요약, 한 줄 표기. 사람이 쓴 문장 없이도 읽힌다.

const base = (o: Partial<ResolutionLite> & { id: string }): ResolutionLite => ({
  alertId: "a-" + o.id,
  serviceId: "svc",
  metric: "CPUUtilization",
  resource: "prod-db",
  title: "SEV-2 prod-db CPU",
  resolvedAt: new Date("2026-09-02T09:00:00Z"),
  durationSec: 42 * 60,
  via: "manual",
  ackedBy: "이서연",
  resolvedBy: "이서연",
  escalationStep: 1,
  muted: false,
  kind: "restart",
  note: null,
  recurredAt: null,
  ...o,
});
const cur = { serviceId: "svc", metric: "CPUUtilization", resource: "prod-db" };

describe("검색 티어", () => {
  it("리소스·메트릭 > 메트릭 > 서비스, 다른 서비스는 0", () => {
    expect(tierOf(base({ id: "1" }), cur)).toBe(1);
    expect(tierOf(base({ id: "2", resource: "prod-db-2" }), cur)).toBe(2);
    expect(tierOf(base({ id: "3", metric: "FreeStorageSpace" }), cur)).toBe(3);
    expect(tierOf(base({ id: "4", serviceId: "other" }), cur)).toBe(0);
  });
  it("메트릭이 없는 현재 알람은 서비스 티어로만 본다", () => {
    expect(tierOf(base({ id: "1" }), { serviceId: "svc", metric: null, resource: null })).toBe(3);
  });
  it("가까운 티어부터, 같은 티어는 최근순, limit", () => {
    const c = [
      base({ id: "old1", resolvedAt: new Date("2026-08-01T00:00:00Z") }),
      base({ id: "svc-only", metric: "X", resolvedAt: new Date("2026-09-08T00:00:00Z") }),
      base({ id: "new1", resolvedAt: new Date("2026-09-05T00:00:00Z") }),
      base({ id: "metric", resource: "prod-db-2", resolvedAt: new Date("2026-09-07T00:00:00Z") }),
      base({ id: "other", serviceId: "zzz" }),
    ];
    expect(pickPrior(c, cur, 3).map((r) => `${r.id}:${r.tier}`)).toEqual(["new1:1", "old1:1", "metric:2"]);
  });
});

describe("요약·표기", () => {
  it("요약은 건수·자동 회복·분류·중간 소요·재발", () => {
    const s = summarize([
      base({ id: "1", via: "auto", kind: "auto", durationSec: 600 }),
      base({ id: "2", via: "auto", kind: "auto", durationSec: 900 }),
      base({ id: "3", durationSec: 3000, recurredAt: new Date() }),
    ]);
    expect(s).toMatchObject({ count: 3, autoCount: 2, recurred: 1, medianMin: 15 });
    expect(describeSummary(s)).toBe("지난 3건 · 자동 회복 2 · 재시작 1 · 중간 15분 · 재발 1");
    expect(describeSummary(summarize([]))).toBe("이전 처리 기록 없음 · 처음 보는 알람");
  });
  it("한 건 표기", () => {
    expect(describeItem(base({ id: "1" }))).toBe("이서연 · 42분 · 재시작");
    expect(describeItem(base({ id: "2", via: "auto", kind: "auto", durationSec: 660, resolvedBy: null }))).toBe("자동 회복 · 11분");
    expect(describeItem(base({ id: "3", escalationStep: 2, recurredAt: new Date(), kind: null }))).toBe("이서연 · 42분 · 2순위까지 · 24h 내 재발");
  });
  it("소요 시간 표기", () => {
    expect(formatDuration(30)).toBe("30초");
    expect(formatDuration(150)).toBe("3분");
    expect(formatDuration(3600 * 2 + 300)).toBe("2시간 5분");
    expect(formatDuration(86400 * 2)).toBe("2일 0시간");
  });
  it("Slack 한 줄", () => {
    expect(priorLine([])).toBe("🕘 이전 처리 기록 없음 · 처음 보는 알람");
    const line = priorLine([base({ id: "1", note: "커넥션 풀 재시작" }), base({ id: "0", resolvedAt: new Date("2026-08-01T00:00:00Z"), kind: "auto", via: "auto" })]);
    expect(line).toContain("지난 2건 · 자동 회복 1 · 재시작 1");
    expect(line).toContain('최근: 이서연 · 42분 · 재시작 "커넥션 풀 재시작" (9/2)');
  });
});
