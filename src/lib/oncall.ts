/**
 * 시간대 온콜(시프트) 해석 — 순수 함수. DB 행을 가벼운 형태로 받아 "지금 이
 * 팀의 순서는 무엇인가"를 돌려준다. PagerDuty 스케줄의 축소판:
 *
 *   override(대체 근무)  >  shift(시프트, priority 큰 것)  >  팀 기본 순서
 *
 * 결과 순서는 이긴 레이어의 사람들 뒤에 나머지를 이어 붙인다(중복 제거) —
 * 당번이 못 받으면 에스컬레이션이 팀 나머지로 계속 가야 하기 때문이다.
 * 시각은 팀 timezone 으로 해석한다(Intl 만 사용, 외부 패키지 없음).
 */

export interface ShiftLite {
  id: string;
  name: string;
  /** 0=일 … 6=토 */
  weekdays: number[];
  /** 자정 기준 분, 0..1439 */
  startMin: number;
  /** 1..1440. startMin 이상이 아니면(<=) 자정을 넘는 창. */
  endMin: number;
  priority: number;
  enabled: boolean;
  /** contactId 순서 */
  members: string[];
}

export interface OverrideLite {
  id: string;
  contactId: string;
  startAt: Date;
  endAt: Date;
  note?: string | null;
}

export interface TeamOrderInput {
  /** 팀 기본 순서 (TeamMember.order) */
  defaultOrder: string[];
  shifts: ShiftLite[];
  overrides: OverrideLite[];
  timezone: string;
  now: Date;
}

export type OnCallSource =
  | { kind: "default" }
  | { kind: "shift"; id: string; name: string }
  | { kind: "override"; id: string; name: string; note: string | null };

export interface TeamOrder {
  order: string[];
  source: OnCallSource;
  /** contactId → 어느 레이어에서 왔는지 표시용 라벨 ("야간", "대체 근무"). 기본 순서는 없음. */
  labelOf: Map<string, string>;
}

export const DEFAULT_TZ = "Asia/Seoul";
export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 유효한 IANA 시간대인지. 잘못된 값은 기본값으로 떨어뜨린다. */
export function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 어떤 시각의 팀 시간대 기준 요일·분. */
export function localParts(now: Date, timezone: string): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone(timezone),
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = WD.indexOf(get("weekday"));
  // "24" 는 일부 런타임이 자정을 그렇게 찍는다.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return { weekday: weekday < 0 ? 0 : weekday, minutes: hour * 60 + minute };
}

/** 시프트 창이 (요일, 분)을 덮는가. 자정 넘김은 시작 요일 기준. */
export function shiftCovers(
  shift: Pick<ShiftLite, "weekdays" | "startMin" | "endMin">,
  weekday: number,
  minutes: number,
): boolean {
  const { startMin, endMin } = shift;
  if (endMin > startMin) {
    return shift.weekdays.includes(weekday) && minutes >= startMin && minutes < endMin;
  }
  // 자정 넘김: 오늘 시작 구간 또는 어제 시작해서 오늘 새벽까지 이어지는 구간.
  const yesterday = (weekday + 6) % 7;
  return (
    (shift.weekdays.includes(weekday) && minutes >= startMin) ||
    (shift.weekdays.includes(yesterday) && minutes < endMin)
  );
}

/** 지금 유효한 시프트. 겹치면 priority 큰 것, 같으면 목록 앞의 것. */
export function activeShift(shifts: ShiftLite[], now: Date, timezone: string): ShiftLite | null {
  const { weekday, minutes } = localParts(now, timezone);
  let best: ShiftLite | null = null;
  for (const s of shifts) {
    if (!s.enabled) continue;
    if (!shiftCovers(s, weekday, minutes)) continue;
    if (!best || s.priority > best.priority) best = s;
  }
  return best;
}

/** 지금 유효한 대체 근무. 겹치면 가장 늦게 시작한 것(가장 구체적인 의도). */
export function activeOverride(overrides: OverrideLite[], now: Date): OverrideLite | null {
  const t = now.getTime();
  let best: OverrideLite | null = null;
  for (const o of overrides) {
    if (o.startAt.getTime() <= t && t < o.endAt.getTime()) {
      if (!best || o.startAt.getTime() > best.startAt.getTime()) best = o;
    }
  }
  return best;
}

function dedup(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** 팀의 "지금 순서". 활성 멤버만 넘겨야 한다(비활성 필터는 호출자 몫). */
export function resolveTeamOrder(input: TeamOrderInput): TeamOrder {
  const tz = safeTimezone(input.timezone);
  const labelOf = new Map<string, string>();
  const shift = activeShift(input.shifts, input.now, tz);
  const override = activeOverride(input.overrides, input.now);

  let order: string[] = [];
  let source: OnCallSource = { kind: "default" };

  if (shift && shift.members.length) {
    order = [...shift.members];
    for (const id of shift.members) labelOf.set(id, shift.name);
    source = { kind: "shift", id: shift.id, name: shift.name };
  }
  if (override) {
    order = [override.contactId, ...order];
    labelOf.set(override.contactId, "대체 근무");
    source = { kind: "override", id: override.id, name: "대체 근무", note: override.note ?? null };
  }
  order = dedup([...order, ...input.defaultOrder]);
  return { order, source, labelOf };
}

// --- 편집 도우미 -------------------------------------------------------------

export function parseWeekdays(raw: string | null | undefined): number[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
}

export function formatWeekdays(days: number[]): string {
  const d = [...new Set(days)].sort();
  if (d.length === 7) return "매일";
  if (d.join() === "1,2,3,4,5") return "평일";
  if (d.join() === "0,6") return "주말";
  return d.map((n) => WEEKDAY_LABELS[n]).join("·");
}

/** "18:00" → 1080. 잘못된 값은 null. */
export function parseHm(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

export function formatHm(min: number): string {
  if (min === 1440) return "24:00";
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function describeShift(s: Pick<ShiftLite, "weekdays" | "startMin" | "endMin">): string {
  const cross = s.endMin <= s.startMin ? " (익일)" : "";
  return `${formatWeekdays(s.weekdays)} ${formatHm(s.startMin)}–${formatHm(s.endMin)}${cross}`;
}

/** 특정 시각에 시간대의 UTC 오프셋(분). */
function tzOffsetMinutes(at: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUtc - at.getTime()) / 60000);
}

/**
 * "YYYY-MM-DDTHH:MM" (datetime-local 값)을 팀 시간대의 벽시계 시각으로 읽어
 * UTC Date 로. 잘못된 입력은 null.
 */
export function fromZoned(local: string | null | undefined, timezone: string): Date | null {
  if (!local) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim());
  if (!m) return null;
  const tz = safeTimezone(timezone);
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  // 오프셋은 시각에 따라 달라질 수 있어(DST) 한 번 보정한다.
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  const candidate = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(candidate), tz);
  const d = new Date(guess - off2 * 60000);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** UTC Date → 팀 시간대의 "YYYY-MM-DDTHH:MM" (datetime-local 기본값용). */
export function toZonedInput(at: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}`;
}

/** 사람이 읽는 시간대 표기: "09-10 (수) 18:00" */
export function formatZoned(at: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: safeTimezone(timezone),
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(at).replace(/\.\s?/g, "-").replace(/-\(/, " (").replace(/-$/, "");
}

export const TIMEZONE_CHOICES = [
  "Asia/Seoul",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Ho_Chi_Minh",
  "Asia/Kolkata",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
] as const;
