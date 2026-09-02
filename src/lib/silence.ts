// 점검 창 · 뮤트 판정의 순수 코어. DB 없이 테스트 가능해야 하므로 서버
// 래퍼(src/server/silences.ts)와 분리한다.
//
// 의미론(요구: v2 프레임 03/04, 노이즈 관리 아키텍처):
// - 통지와 자동 에스컬레이션만 멈춘다. 수집·상태 전이·화면 표시는 계속된다.
// - 스코프는 정확히 하나: 알람 단위(alertId) 또는 조직 단위. 조직 스코프는
//   하위로 상속된다 — 고객사 뮤트는 그 아래 모든 프로젝트/서비스를 덮는다.
//   (상속 해석은 매칭 시점에 알람의 체인 id로 푼다: 알람이 속한 서비스·
//   프로젝트·고객사 id 중 하나라도 걸리면 뮤트다.)

export interface SilenceRow {
  id: string;
  alertId: string | null;
  customerId: string | null;
  projectId: string | null;
  serviceId: string | null;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  createdBy: string | null;
  revokedAt: Date | null;
}

/** 알람 하나의 매칭 좌표 — 체인이 없으면(미매핑) alertId 뮤트만 잡힌다. */
export interface SilenceScope {
  alertId?: string | null;
  customerId?: string | null;
  projectId?: string | null;
  serviceId?: string | null;
}

export type SilenceStatus = "scheduled" | "active" | "ended" | "revoked";

export function silenceStatus(s: SilenceRow, now: Date): SilenceStatus {
  if (s.revokedAt) return "revoked";
  if (now < s.startsAt) return "scheduled";
  if (now >= s.endsAt) return "ended";
  return "active";
}

export function isActive(s: SilenceRow, now: Date): boolean {
  return silenceStatus(s, now) === "active";
}

/**
 * 지금 이 알람을 덮는 뮤트를 찾는다. 여럿이면 가장 늦게 끝나는 것 —
 * 화면의 "뮤트 ~HH:MMZ" 표기가 실제 조용한 기간과 일치해야 한다.
 */
export function matchSilence(
  silences: SilenceRow[],
  scope: SilenceScope,
  now: Date,
): SilenceRow | null {
  let best: SilenceRow | null = null;
  for (const s of silences) {
    if (!isActive(s, now)) continue;
    const hit =
      (s.alertId !== null && s.alertId === scope.alertId) ||
      (s.serviceId !== null && s.serviceId === scope.serviceId) ||
      (s.projectId !== null && s.projectId === scope.projectId) ||
      (s.customerId !== null && s.customerId === scope.customerId);
    if (!hit) continue;
    if (!best || s.endsAt > best.endsAt) best = s;
  }
  return best;
}

/** "~12:20Z" — 뮤트 칩용 종료 시각 표기. */
export function muteUntilLabel(endsAt: Date): string {
  return `~${endsAt.toISOString().slice(11, 16)}Z`;
}
