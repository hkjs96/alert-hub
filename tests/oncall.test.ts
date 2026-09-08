import { describe, expect, it } from "vitest";
import {
  activeShift,
  describeShift,
  formatWeekdays,
  fromZoned,
  localParts,
  parseHm,
  parseWeekdays,
  resolveTeamOrder,
  shiftCovers,
  toZonedInput,
  type ShiftLite,
} from "@/lib/oncall";

// 시간대 온콜: 팀 안에서 요일·시간 창마다 순서가 다르다. 대체 근무 > 시프트 >
// 팀 기본 순서. 이긴 레이어 뒤에 나머지가 이어져 에스컬레이션이 끊기지 않는다.

const KST = "Asia/Seoul";
// 2026-09-09 (수) 22:00 KST = 13:00Z
const wedNight = new Date("2026-09-09T13:00:00Z");
// 2026-09-10 (목) 03:00 KST = 2026-09-09 18:00Z
const thuDawn = new Date("2026-09-09T18:00:00Z");
// 2026-09-10 (목) 14:00 KST
const thuDay = new Date("2026-09-10T05:00:00Z");
// 2026-09-12 (토) 14:00 KST
const satDay = new Date("2026-09-12T05:00:00Z");

const shift = (o: Partial<ShiftLite> & { id: string }): ShiftLite => ({
  name: o.id,
  weekdays: [1, 2, 3, 4, 5],
  startMin: 18 * 60,
  endMin: 9 * 60,
  priority: 0,
  enabled: true,
  members: [],
  ...o,
});

describe("팀 시간대 기준 요일·분", () => {
  it("UTC 시각을 팀 시간대로 읽는다", () => {
    expect(localParts(wedNight, KST)).toEqual({ weekday: 3, minutes: 22 * 60 });
    expect(localParts(wedNight, "UTC")).toEqual({ weekday: 3, minutes: 13 * 60 });
    // 자정 넘어 다음 날
    expect(localParts(thuDawn, KST)).toEqual({ weekday: 4, minutes: 3 * 60 });
  });
  it("잘못된 시간대는 Asia/Seoul 로 떨어진다", () => {
    expect(localParts(wedNight, "Mars/Olympus")).toEqual({ weekday: 3, minutes: 22 * 60 });
  });
});

describe("시프트 창", () => {
  const night = shift({ id: "night" }); // 평일 18:00 → 익일 09:00
  it("자정을 넘는 창은 시작 요일 기준으로 다음 날 새벽까지 덮는다", () => {
    expect(shiftCovers(night, 3, 22 * 60)).toBe(true); // 수 22:00
    expect(shiftCovers(night, 4, 3 * 60)).toBe(true); // 목 03:00 (수요일 야간의 연장)
    expect(shiftCovers(night, 4, 14 * 60)).toBe(false); // 목 14:00
    expect(shiftCovers(night, 6, 3 * 60)).toBe(true); // 토 03:00 (금요일 야간의 연장)
    expect(shiftCovers(night, 0, 3 * 60)).toBe(false); // 일 03:00 (토요일은 평일 아님)
  });
  it("같은 날 창은 [start, end)", () => {
    const day = shift({ id: "day", startMin: 9 * 60, endMin: 18 * 60 });
    expect(shiftCovers(day, 1, 9 * 60)).toBe(true);
    expect(shiftCovers(day, 1, 18 * 60)).toBe(false);
    expect(shiftCovers(day, 0, 12 * 60)).toBe(false);
  });
  it("겹치면 priority 큰 시프트, 꺼진 시프트는 무시", () => {
    const all = shift({ id: "all", weekdays: [0, 1, 2, 3, 4, 5, 6], startMin: 0, endMin: 1440, priority: 0 });
    const night = shift({ id: "night", priority: 5 });
    const off = shift({ id: "off", priority: 99, enabled: false });
    expect(activeShift([all, night, off], wedNight, KST)?.id).toBe("night");
    expect(activeShift([all, night, off], thuDay, KST)?.id).toBe("all");
    expect(activeShift([night], thuDay, KST)).toBeNull();
  });
});

describe("팀 순서 해석", () => {
  const defaultOrder = ["kim", "lee", "park"];
  const night = shift({ id: "night", name: "야간", members: ["park", "lee"] });

  it("시프트 밖이면 팀 기본 순서", () => {
    const r = resolveTeamOrder({ defaultOrder, shifts: [night], overrides: [], timezone: KST, now: thuDay });
    expect(r.order).toEqual(defaultOrder);
    expect(r.source).toEqual({ kind: "default" });
    expect(r.labelOf.size).toBe(0);
  });

  it("시프트 안이면 당번이 앞에 오고 나머지 팀원이 뒤에 이어진다", () => {
    const r = resolveTeamOrder({ defaultOrder, shifts: [night], overrides: [], timezone: KST, now: wedNight });
    expect(r.order).toEqual(["park", "lee", "kim"]);
    expect(r.source).toEqual({ kind: "shift", id: "night", name: "야간" });
    expect(r.labelOf.get("park")).toBe("야간");
    expect(r.labelOf.has("kim")).toBe(false);
  });

  it("주말은 평일 야간 시프트에 안 걸린다", () => {
    const r = resolveTeamOrder({ defaultOrder, shifts: [night], overrides: [], timezone: KST, now: satDay });
    expect(r.source.kind).toBe("default");
  });

  it("대체 근무는 시프트보다 앞서고, 그 사람이 1순위가 된다", () => {
    const r = resolveTeamOrder({
      defaultOrder,
      shifts: [night],
      overrides: [
        { id: "o1", contactId: "choi", startAt: new Date("2026-09-09T00:00:00Z"), endAt: new Date("2026-09-11T00:00:00Z"), note: "박지훈 휴가" },
      ],
      timezone: KST,
      now: wedNight,
    });
    expect(r.order).toEqual(["choi", "park", "lee", "kim"]);
    expect(r.source).toEqual({ kind: "override", id: "o1", name: "대체 근무", note: "박지훈 휴가" });
    expect(r.labelOf.get("choi")).toBe("대체 근무");
  });

  it("기간이 지난 대체 근무는 무시하고, 멤버 없는 시프트는 기본 순서", () => {
    const r = resolveTeamOrder({
      defaultOrder,
      shifts: [shift({ id: "empty", name: "빈 시프트" })],
      overrides: [{ id: "o0", contactId: "choi", startAt: new Date("2026-09-01T00:00:00Z"), endAt: new Date("2026-09-02T00:00:00Z") }],
      timezone: KST,
      now: wedNight,
    });
    expect(r.order).toEqual(defaultOrder);
    expect(r.source.kind).toBe("default");
  });

  it("시프트 멤버가 기본 순서에도 있으면 한 번만 나온다", () => {
    const r = resolveTeamOrder({ defaultOrder, shifts: [shift({ id: "n", members: ["kim"] })], overrides: [], timezone: KST, now: wedNight });
    expect(r.order).toEqual(["kim", "lee", "park"]);
  });
});

describe("편집 도우미", () => {
  it("요일 파싱·표기", () => {
    expect(parseWeekdays("5,1,1,9,x,3")).toEqual([1, 3, 5]);
    expect(formatWeekdays([1, 2, 3, 4, 5])).toBe("평일");
    expect(formatWeekdays([0, 6])).toBe("주말");
    expect(formatWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe("매일");
    expect(formatWeekdays([1, 3])).toBe("월·수");
  });
  it("시각 파싱·시프트 설명", () => {
    expect(parseHm("18:00")).toBe(1080);
    expect(parseHm("9:05")).toBe(545);
    expect(parseHm("25:00")).toBeNull();
    expect(describeShift({ weekdays: [1, 2, 3, 4, 5], startMin: 1080, endMin: 540 })).toBe("평일 18:00–09:00 (익일)");
    expect(describeShift({ weekdays: [0, 6], startMin: 0, endMin: 1440 })).toBe("주말 00:00–24:00");
  });
  it("datetime-local 값을 팀 시간대로 읽고 되돌린다", () => {
    const d = fromZoned("2026-09-10T18:00", KST);
    expect(d?.toISOString()).toBe("2026-09-10T09:00:00.000Z");
    expect(toZonedInput(d!, KST)).toBe("2026-09-10T18:00");
    expect(fromZoned("2026-09-10T18:00", "UTC")?.toISOString()).toBe("2026-09-10T18:00:00.000Z");
    // DST 있는 시간대
    expect(fromZoned("2026-07-01T12:00", "America/New_York")?.toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(fromZoned("2026-01-01T12:00", "America/New_York")?.toISOString()).toBe("2026-01-01T17:00:00.000Z");
    expect(fromZoned("garbage", KST)).toBeNull();
  });
});
