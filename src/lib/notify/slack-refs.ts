import type { MessageRef } from "@/lib/notify/slack-api";

/**
 * 봇 메시지 좌표를 기록하는 훅. lib 은 DB 를 모르므로 서버 쪽(src/server/slack-sync.ts)
 * 이 기록기를 등록한다. 등록 전이면 조용히 버린다.
 */
export type SlackRefRecorder = (alertId: string, ref: MessageRef, text: string) => Promise<void>;

let recorder: SlackRefRecorder | null = null;

export function setSlackRefRecorder(fn: SlackRefRecorder | null) {
  recorder = fn;
}

export async function recordSlackRef(alertId: string, ref: MessageRef | null, text: string): Promise<void> {
  if (!ref || !recorder) return;
  try {
    await recorder(alertId, ref, text);
  } catch (err) {
    console.error("[notify:slack] failed to record message ref", err);
  }
}
