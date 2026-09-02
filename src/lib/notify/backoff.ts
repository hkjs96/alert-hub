// 아웃박스 재시도 정책 (v2 상세 화면 문구 그대로): 30s · 1m · 2m · 5m · 10m,
// 5회 실패 시 포기. 순수 값/함수라 큐와 분리해 테스트한다.

export const MAX_ATTEMPTS = 5;

/** n번째 시도(1-based)가 실패했을 때 다음 시도까지의 간격(초). */
const GAPS_SECONDS = [30, 60, 120, 300, 600];

/**
 * attemptsMade번의 시도를 마친 잡의 다음 시도 시각. 더 시도하지 않으면
 * (포기) null.
 */
export function nextAttemptAt(attemptsMade: number, now: Date): Date | null {
  if (attemptsMade >= MAX_ATTEMPTS) return null;
  const gap = GAPS_SECONDS[Math.min(attemptsMade - 1, GAPS_SECONDS.length - 1)];
  return new Date(now.getTime() + gap * 1000);
}
