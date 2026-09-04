import type { NormalizedAlert } from "@/lib/types";
import type { NotifyTarget } from "@/lib/notify/targets";
import { slackNotifier } from "@/lib/notify/slack";
import { emailNotifier } from "@/lib/notify/email";
import { twilioNotifier } from "@/lib/notify/twilio";

/** Extra context a notifier can use but must not require. */
export interface NotifyContext {
  /** DB id of the stored alert, for building dashboard deep links. */
  alertId?: string;
  /**
   * Notification order resolved at fire time — [0] is 1순위. Absent when the
   * alert's account is unmapped, unassigned, or resolution failed; notifiers
   * must degrade to the plain message.
   */
  assignees?: {
    name: string;
    slackId?: string | null;
    email?: string | null;
    phone?: string | null;
  }[];
  /**
   * Set by the escalation cron (Phase 3): 1-based rank of the person being
   * paged now — assignees then holds just that person. Notifiers label the
   * message as an escalation instead of a fresh FIRING fan-out.
   */
  escalationStep?: number;
  /**
   * "고객사 › 프로젝트 › 서비스" — 묶음 통지(다이제스트) 헤더와 메시지의
   * 조직 표기에 쓰인다. 미매핑 알람에는 없다.
   */
  chainLabel?: string;
  /**
   * 스코프에서 해석된 Slack 목적지들(고객사/프로젝트/서비스 채널). 비어 있으면
   * 전사 기본 채널로. 아웃박스 페이로드에 함께 저장된다.
   */
  targets?: NotifyTarget[];
}

// A Notifier is any channel that can deliver an alert — Slack, email, Twilio.
// A new channel is just another entry in the registry; nothing else in the
// pipeline changes.
//
// notify() distinguishes "sent" from "skipped" (no recipients, or the channel
// doesn't apply to this kind of notification) so the delivery log records only
// what actually went out.
export type NotifyResult = "sent" | "skipped";

export interface Notifier {
  readonly name: string;
  /** True when the notifier is configured and able to send. */
  isConfigured(): boolean;
  notify(alert: NormalizedAlert, ctx?: NotifyContext): Promise<NotifyResult>;
}

/** What happened on one channel during a fan-out. */
export interface NotifyOutcome {
  channel: string;
  status: NotifyResult | "failed";
  error?: string;
}

const notifiers: Notifier[] = [slackNotifier, emailNotifier, twilioNotifier];

/** 지금 설정된 채널 이름들 — 아웃박스가 어떤 잡을 만들지 결정한다. */
export function configuredChannels(): string[] {
  return notifiers.filter((n) => n.isConfigured()).map((n) => n.name);
}

/** 채널 이름으로 노티파이어를 찾는다 (아웃박스 드레인용). */
export function getNotifier(name: string): Notifier | undefined {
  return notifiers.find((n) => n.name === name);
}

/** Testable core of notifyAll — the registry is injected. */
export async function runNotifiers(
  list: Notifier[],
  alert: NormalizedAlert,
  ctx: NotifyContext,
): Promise<NotifyOutcome[]> {
  return Promise.all(
    list
      .filter((n) => n.isConfigured())
      .map(async (n): Promise<NotifyOutcome> => {
        try {
          const status = await n.notify(alert, ctx);
          return { channel: n.name, status: status ?? "sent" };
        } catch (err) {
          console.error(`[notify:${n.name}] failed`, err);
          return {
            channel: n.name,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
  );
}

/**
 * Fan an alert out to every configured notifier. Failures are contained per
 * channel — one broken channel never blocks ingest or the others — and the
 * per-channel outcomes are returned so the caller can persist a delivery log.
 */
export async function notifyAll(
  alert: NormalizedAlert,
  ctx: NotifyContext = {},
): Promise<NotifyOutcome[]> {
  return runNotifiers(notifiers, alert, ctx);
}
