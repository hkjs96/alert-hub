/**
 * 수집 보안 규칙 — 순수 함수. "누가 보냈는지"를 확인한다.
 *
 * SNS 서명은 "AWS SNS 가 보냈다"만 증명한다. 알람 본문의 계정 ID(AlarmArn)는 보낸 쪽이 적는
 * 값이라 믿을 수 없고, 봉투의 TopicArn 은 SNS 가 서명한 값이라 믿을 수 있다. 그래서:
 *
 *  1. 등록된 고객사 계정을 내세운 알람은, SNS 주제 계정도 같은 고객사 계정이어야 한다.
 *     (남의 계정 ID 를 적어 보내 그 고객사 담당자를 깨우는 위조를 막는다)
 *  2. 고객사 전용 수집 주소(토큰)로 온 알람은 그 고객사 계정의 알람이어야 한다.
 *  3. 등록 안 된 계정의 알람은 지금처럼 "미매핑"으로 받는다 — 아무도 페이징하지 않고,
 *     새 계정을 매핑하는 입구로 쓰인다.
 */

/** arn:aws:sns:<region>:<account>:<topic> → account */
export function topicAccountOf(topicArn: string | null | undefined): string | null {
  const m = (topicArn ?? "").match(/^arn:aws(?:-[a-z]+)*:sns:[a-z0-9-]+:(\d{12}):[\w-]+$/);
  return m ? m[1] : null;
}

export interface AlertGuardInput {
  /** 알람이 주장하는 계정과 그 계정이 매핑된 고객사(없으면 미매핑). */
  alertAccount: string | null;
  alertCustomer: string | null;
  /** SNS 로 왔으면 서명된 주제의 계정과 그 고객사. 직접 POST 면 fromSns=false. */
  fromSns: boolean;
  topicAccount: string | null;
  topicCustomer: string | null;
  /** 고객사 전용 수집 주소로 왔으면 그 고객사. 공용 주소면 null. */
  tokenCustomer: string | null;
}

export type GuardDecision = { ok: true } | { ok: false; reason: string };

export function checkAlert(i: AlertGuardInput): GuardDecision {
  if (i.tokenCustomer && i.alertCustomer && i.alertCustomer !== i.tokenCustomer) {
    return { ok: false, reason: `고객사 전용 주소로 다른 고객사 계정(${i.alertAccount})의 알람이 왔습니다` };
  }
  if (i.alertCustomer && i.fromSns && i.topicCustomer !== i.alertCustomer) {
    return {
      ok: false,
      reason: i.topicAccount
        ? `SNS 주제 계정(${i.topicAccount})이 알람 계정(${i.alertAccount})의 고객사 계정이 아닙니다`
        : `SNS 주제 계정을 확인할 수 없습니다 (알람 계정 ${i.alertAccount})`,
    };
  }
  return { ok: true };
}

/**
 * 구독 확인(SubscriptionConfirmation): 고객사 전용 주소면 주제 계정이 그 고객사 계정이어야 수락.
 * 공용 주소는 지금처럼 수락 — 미매핑 알람은 페이징하지 않으므로 위험이 작다.
 */
export function checkSubscription(i: { topicAccount: string | null; topicCustomer: string | null; tokenCustomer: string | null }): GuardDecision {
  if (!i.tokenCustomer) return { ok: true };
  if (i.topicCustomer === i.tokenCustomer) return { ok: true };
  return {
    ok: false,
    reason: `주제 계정(${i.topicAccount ?? "?"})이 이 고객사에 매핑돼 있지 않습니다 — 먼저 계정 매핑을 하고 다시 구독하세요`,
  };
}

/** 고객사 수집 토큰: URL 에 넣기 쉬운 형태, 추측 불가. */
export function newIngestToken(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return `in_${Array.from(random(20), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
