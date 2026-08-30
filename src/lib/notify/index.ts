import type { NormalizedAlert } from "@/lib/types";
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
