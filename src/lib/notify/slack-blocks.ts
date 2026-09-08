/**
 * Slack Block Kit 메시지 조립 — 순수 함수. 본문 텍스트(mrkdwn)는 그대로 두고
 * 아래에 상태 줄(context)과 버튼(actions)을 붙인다. 버튼은 봇 메시지에서만
 * 동작하므로(인터랙션 페이로드가 우리 앱으로 와야 함) 웹훅 목적지에는
 * 텍스트만 보낸다.
 */

export type AlertMsgStatus = "FIRING" | "ACKNOWLEDGED" | "RESOLVED";

export interface AlertMsgState {
  alertId: string;
  status: AlertMsgStatus;
  /** 상태 줄에 붙일 메모 ("김도윤 님이 확인 · 16:20"). */
  note?: string | null;
  /** 뮤트 중이면 그 안내 ("1시간 뮤트 · 김도윤"). */
  muted?: string | null;
  appUrl?: string | null;
}

export const ACTION_ACK = "ah_ack";
export const ACTION_RESOLVE = "ah_resolve";
export const ACTION_MUTE = "ah_mute";
export const ACTIONS = [ACTION_ACK, ACTION_RESOLVE, ACTION_MUTE] as const;
export type ActionId = (typeof ACTIONS)[number];

export function isActionId(v: unknown): v is ActionId {
  return typeof v === "string" && (ACTIONS as readonly string[]).includes(v);
}

type Block = Record<string, unknown>;

function button(actionId: ActionId, label: string, value: string, style?: "primary" | "danger"): Block {
  return {
    type: "button",
    action_id: actionId,
    text: { type: "plain_text", text: label, emoji: true },
    value,
    ...(style ? { style } : {}),
  };
}

export function buildAlertBlocks(text: string, state: AlertMsgState): Block[] {
  const blocks: Block[] = [{ type: "section", text: { type: "mrkdwn", text } }];

  const ctx: string[] = [];
  if (state.status === "ACKNOWLEDGED") ctx.push(`✓ 확인됨${state.note ? ` · ${state.note}` : ""}`);
  if (state.status === "RESOLVED") ctx.push(`● 해결됨${state.note ? ` · ${state.note}` : ""}`);
  if (state.muted) ctx.push(`🔇 ${state.muted}`);
  if (ctx.length) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: ctx.join("   ") }] });
  }

  const elements: Block[] = [];
  if (state.status === "FIRING") elements.push(button(ACTION_ACK, "✓ 확인 (Ack)", state.alertId, "primary"));
  if (state.status !== "RESOLVED") elements.push(button(ACTION_RESOLVE, "해결 (Resolve)", state.alertId));
  if (state.status !== "RESOLVED" && !state.muted) elements.push(button(ACTION_MUTE, "1시간 뮤트", state.alertId));
  if (state.appUrl) {
    elements.push({
      type: "button",
      text: { type: "plain_text", text: "alert-hub 에서 열기" },
      url: `${state.appUrl.replace(/\/+$/, "")}/alerts/${state.alertId}`,
      action_id: "ah_open",
    });
  }
  if (elements.length) blocks.push({ type: "actions", block_id: `ah:${state.alertId}`, elements });
  return blocks;
}

/** 스레드에 남길 한 줄. */
export function threadLine(status: AlertMsgStatus | "MUTED", actor: string | null, via: string): string {
  // 사람이 없으면(공급자 OK 등) "누군가"라 하지 않고 상태만 말한다.
  switch (status) {
    case "ACKNOWLEDGED":
      return actor ? `✓ ${actor} 님이 확인했습니다 (${via})` : `✓ 확인됨 (${via})`;
    case "RESOLVED":
      return actor ? `● ${actor} 님이 해결 처리했습니다 (${via})` : `● 해결됨 (${via})`;
    case "MUTED":
      return actor ? `🔇 ${actor} 님이 1시간 뮤트했습니다 (${via})` : `🔇 1시간 뮤트 (${via})`;
    default:
      return actor ? `${actor} 님이 상태를 바꿨습니다 (${via})` : `상태가 바뀌었습니다 (${via})`;
  }
}
