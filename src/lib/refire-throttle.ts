// 재발화 스로틀 (노이즈 관리 트랙 ②). 해소↔재발화를 반복(플랩)하는 알람이
// 전이 때마다 재페이징하는 것을 막는다: 마지막 FIRING 팬아웃 후 N분 안의
// 재발화는 통지를 건너뛴다. 수집·이벤트·count·스냅샷 갱신은 그대로다.
//
// ack 스티키가 "사람이 잡은 인시던트"의 재페이징을 막는다면, 이 스로틀은
// 아무도 잡기 전의 기계적 플랩을 막는다. 에스컬레이션 사다리는 영향받지
// 않는다 — 스로틀은 최초 팬아웃에만 적용된다.

export const DEFAULT_REFIRE_THROTTLE_MINUTES = 10;

/** REFIRE_THROTTLE_MINUTES — 기본 10분, 0이면 스로틀 끔. */
export function refireThrottleMinutesFromEnv(): number {
  const raw = process.env.REFIRE_THROTTLE_MINUTES;
  if (raw === undefined || raw === "") return DEFAULT_REFIRE_THROTTLE_MINUTES;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_REFIRE_THROTTLE_MINUTES;
}

/** 이번 팬아웃을 스로틀해야 하는가. lastNotifiedAt이 없으면 항상 아니오. */
export function shouldThrottleRefire(
  lastNotifiedAt: Date | string | null,
  now: Date,
  throttleMinutes: number,
): boolean {
  if (!lastNotifiedAt || throttleMinutes <= 0) return false;
  const elapsedMs = now.getTime() - new Date(lastNotifiedAt).getTime();
  return elapsedMs >= 0 && elapsedMs < throttleMinutes * 60_000;
}
