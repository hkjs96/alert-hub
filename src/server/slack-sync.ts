import { prisma } from "@/lib/prisma";
import { isBotConfigured, postThread, updateMessage } from "@/lib/notify/slack-api";
import { setSlackRefRecorder } from "@/lib/notify/slack-refs";
import { buildAlertBlocks, buildKindPromptBlocks, threadLine, type AlertMsgStatus } from "@/lib/notify/slack-blocks";

// 웹·웹훅·Slack 버튼 어디서 상태가 바뀌든, 이 알람으로 나간 봇 메시지들을
// 같은 모양으로 맞춘다: 본문은 그대로, 상태 줄과 버튼만 갈아끼우고 스레드에
// 한 줄. 실패는 삼킨다 — Slack 이 죽었다고 ack 가 실패하면 안 된다.

// lib 쪽 노티파이어가 보낸 좌표를 여기서 받아 저장한다 (모듈 로드 시 등록).
setSlackRefRecorder(async (alertId, ref, text) => {
  await prisma.slackMessage.create({ data: { alertId, channel: ref.channel, ts: ref.ts, text } });
});

/** import 만으로 등록되게 하는 자리표시 — 트리셰이킹·미사용 import 경고 방지. */
export function ensureSlackSyncRegistered(): void {}

export interface SlackSyncState {
  status: AlertMsgStatus;
  /** 상태 줄 메모 ("김도윤 · Slack"). */
  note?: string | null;
  /** 뮤트 안내. */
  muted?: string | null;
}

export interface ThreadNote {
  status: AlertMsgStatus | "MUTED";
  actor: string | null;
  via: string;
  /** 사람이 닫은 해결이면 그 기록 id — 스레드에 분류 버튼이 붙는다. */
  resolutionId?: string;
}

/** 스레드 한 줄 + (해결이면) 분류 버튼. route 와 sync 가 같은 모양을 쓴다. */
export async function postThreadNote(ref: { channel: string; ts: string }, note: ThreadNote): Promise<void> {
  const text = threadLine(note.status, note.actor, note.via);
  if (note.resolutionId) await postThread(ref, text, undefined, buildKindPromptBlocks(text, note.resolutionId));
  else await postThread(ref, text);
}

function nowLabel(): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

/**
 * 이 알람의 봇 메시지 전부를 갱신하고 스레드에 한 줄 남긴다.
 * `except` 는 버튼을 누른 그 메시지(response_url 로 이미 교체됐고 스레드도 호출자가
 * 직접 남긴다)를 통째로 건너뛸 때.
 */
export async function syncSlackMessages(
  alertId: string,
  state: SlackSyncState,
  thread: ThreadNote | null,
  except?: { channel: string; ts: string },
): Promise<void> {
  if (!isBotConfigured()) return;
  let rows: { channel: string; ts: string; text: string }[] = [];
  try {
    rows = await prisma.slackMessage.findMany({ where: { alertId }, orderBy: { createdAt: "asc" } });
  } catch (err) {
    console.error("[slack-sync] lookup failed", err);
    return;
  }
  const appUrl = process.env.APP_URL ?? null;
  const note = state.note ? `${state.note} · ${nowLabel()}` : nowLabel();
  for (const m of rows) {
    const ref = { channel: m.channel, ts: m.ts };
    if (except && except.channel === m.channel && except.ts === m.ts) continue;
    try {
      await updateMessage(
        ref,
        m.text,
        buildAlertBlocks(m.text, { alertId, status: state.status, note, muted: state.muted, appUrl }),
      );
      if (thread) await postThreadNote(ref, thread);
    } catch (err) {
      console.error(`[slack-sync] update ${m.channel}/${m.ts} failed`, err);
    }
  }
}
