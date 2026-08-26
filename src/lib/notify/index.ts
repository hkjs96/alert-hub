import type { NormalizedAlert } from "@/lib/types";
import { slackNotifier } from "@/lib/notify/slack";
import { emailNotifier } from "@/lib/notify/email";

/** Extra context a notifier can use but must not require. */
export interface NotifyContext {
  /** DB id of the stored alert, for building dashboard deep links. */
  alertId?: string;
  /**
   * Notification order resolved at fire time — [0] is 1순위. Absent when the
   * alert's account is unmapped, unassigned, or resolution failed; notifiers
   * must degrade to the plain message.
   */
  assignees?: { name: string; slackId?: string | null; email?: string | null }[];
  /**
   * Set by the escalation cron (Phase 3): 1-based rank of the person being
   * paged now — assignees then holds just that person. Notifiers label the
   * message as an escalation instead of a fresh FIRING fan-out.
   */
  escalationStep?: number;
}

// A Notifier is any channel that can deliver an alert. Today there is exactly
// one (Slack); email, then Twilio SMS/voice, get added later simply by
// registering more notifiers here — nothing else in the pipeline changes.
export interface Notifier {
  readonly name: string;
  /** True when the notifier is configured and able to send. */
  isConfigured(): boolean;
  notify(alert: NormalizedAlert, ctx?: NotifyContext): Promise<void>;
}

const notifiers: Notifier[] = [slackNotifier, emailNotifier];

/**
 * Fan an alert out to every configured notifier. Failures are swallowed per
 * notifier so one broken channel never blocks ingest or the others.
 */
export async function notifyAll(
  alert: NormalizedAlert,
  ctx: NotifyContext = {},
): Promise<void> {
  await Promise.all(
    notifiers
      .filter((n) => n.isConfigured())
      .map(async (n) => {
        try {
          await n.notify(alert, ctx);
        } catch (err) {
          console.error(`[notify:${n.name}] failed`, err);
        }
      }),
  );
}
