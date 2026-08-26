// 시간 기반 자동 에스컬레이션 (Phase 3, v0.3 §10 로드맵).
//
// 규칙 하나: FIRING인 채로 N분 동안 아무도 ack하지 않으면 스냅샷 순서의 다음
// 사람에게 통지한다. 판정은 순수 함수 — cron 라우트는 DB 왕복과 통지만 하고,
// "언제 누구 차례인가"는 여기서 결정되어 단위 테스트로 고정된다.
//
// 순서의 근거는 수신 시점 스냅샷이다: 인시던트가 시작될 때 통지된 그 리스트를
// 끝까지 걷는다. 도중에 팀 순서를 바꿔도 진행 중인 인시던트의 사다리는 바뀌지
// 않는다 (다음 인시던트부터 새 순서).

export const DEFAULT_ACK_MINUTES = 10;

export interface EscalationCandidate {
  status: string;
  /** People of the frozen order already notified. 1 = 1순위 only. */
  escalationStep: number;
  /** When the last escalation notification went out (null = none yet). */
  escalatedAt: Date | string | null;
  /** When the current incident fired — the snapshot's capturedAt. */
  firedAt: Date | string | null;
  /** Length of the frozen notification order. */
  orderLength: number;
}

/**
 * 0-based index into the frozen order of the person to page NOW, or null when
 * nothing is due: not firing, ladder exhausted, no time base, or the ack
 * window hasn't elapsed since the last notification (fire or escalation).
 */
export function nextEscalation(
  c: EscalationCandidate,
  now: Date,
  ackMinutes: number,
): number | null {
  if (c.status !== "FIRING") return null;
  if (c.escalationStep < 1 || c.escalationStep >= c.orderLength) return null;

  const base = c.escalatedAt ?? c.firedAt;
  if (!base) return null;
  const baseMs = new Date(base).getTime();
  if (!Number.isFinite(baseMs)) return null;

  if (now.getTime() - baseMs < ackMinutes * 60_000) return null;
  return c.escalationStep;
}

/** ESCALATION_ACK_MINUTES env, defaulting on absent/garbage/non-positive. */
export function ackMinutesFromEnv(
  raw: string | undefined = process.env.ESCALATION_ACK_MINUTES,
): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ACK_MINUTES;
}
