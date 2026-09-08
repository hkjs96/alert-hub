import { prisma } from "@/lib/prisma";
import { syncSlackMessages } from "@/server/slack-sync";

// 사람이 만든 상태 전이의 공통 경로 — 알람 상세 버튼, 대시보드 일괄 Ack,
// Slack 버튼이 모두 여기를 지난다. 가드된 updateMany 라 중복 제출·경쟁은
// 조용한 no-op 이고, 이력은 append-only AlertEvent 로 남는다.

export type HumanTransition = "ACKNOWLEDGED" | "RESOLVED";

export interface TransitionInput {
  id: string;
  from: string[];
  to: HumanTransition;
  /** 이벤트 stateReason 의 앞부분 ("수동 Ack (알람 상세)"). */
  reason: string;
  /** 누가 (SSO 이름 · Slack 이름). null 이면 익명. */
  actor: string | null;
  /** 어디서 ("알람 상세" · "Slack") — 스레드 한 줄용. */
  via: string;
  /** Slack 버튼이 만든 전이면 그 메시지는 response_url 로 이미 갱신됐으니 건너뛴다. */
  skipSlackMessage?: { channel: string; ts: string };
}

/** 전이가 실제로 일어났으면 true. */
export async function transitionAlert(input: TransitionInput): Promise<boolean> {
  const { id, from, to, reason, actor } = input;
  const moved = await prisma.alert.updateMany({
    where: { id, status: { in: from } },
    data: { status: to, ...(to === "ACKNOWLEDGED" && actor ? { ackedBy: actor } : {}) },
  });
  if (moved.count === 0) return false;
  await prisma.alertEvent.create({
    data: { alertId: id, status: to, stateReason: actor ? `${reason} · ${actor}` : reason },
  });
  // Slack 쪽 메시지 동기화는 부수 효과 — 실패해도 전이는 이미 끝났다.
  try {
    await syncSlackMessages(
      id,
      { status: to, note: actor ? `${actor} · ${input.via}` : input.via },
      { status: to, actor, via: input.via },
      input.skipSlackMessage,
    );
  } catch (err) {
    console.error("[transition] slack sync failed", err);
  }
  return true;
}
