import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  configuredChannels,
  getNotifier,
  type NotifyContext,
  type NotifyOutcome,
} from "@/lib/notify";
import { MAX_ATTEMPTS, nextAttemptAt } from "@/lib/notify/backoff";
import type { NormalizedAlert } from "@/lib/types";

// 통지 아웃박스 (신뢰성 트랙 ①).
//
// 발화 팬아웃은 이제 "채널별 잡 생성 → 인라인 1회 시도"다. 성공하면 지금까지와
// 똑같이 즉시 나가고, 실패한 채널의 잡만 pending으로 남아 틱(/api/cron/notify)
// 이 지수 백오프로 재시도한다. 5회 실패 시 포기(failed)하고 NotificationLog에
// 남긴다 — 실패는 조용히 증발하는 대신 상세 화면에 보인다.
//
// 선점: attempts 낙관적 갱신. 클레임이 다음 시도 시각까지 미리 적어 두므로
// 발송 중 크래시해도 잡은 그 시각에 자연히 되살아난다.

interface JobPayload {
  alert: NormalizedAlert;
  ctx: NotifyContext;
}

type JobRow = Prisma.NotificationJobGetPayload<object>;

/**
 * Persist the per-channel outcomes of one fan-out as NotificationLog rows.
 * skipped 채널(수신자 없음, 해당 없음)은 기록하지 않는다 — 로그는 "나갔다"와
 * "나가려다 실패했다"만 담는다. 로그 실패가 통지나 ingest를 죽여선 안 되므로
 * 여기서 삼킨다.
 */
export async function recordNotifications(
  alertId: string,
  ctx: NotifyContext,
  outcomes: NotifyOutcome[] | undefined,
): Promise<void> {
  const rows = (outcomes ?? [])
    .filter((o) => o.status !== "skipped")
    .map((o) => ({
      alertId,
      channel: o.channel,
      target: ctx.assignees?.length
        ? `${ctx.assignees[0].name}${
            ctx.assignees.length > 1 ? ` 외 ${ctx.assignees.length - 1}명` : ""
          }`
        : null,
      escalationStep: ctx.escalationStep ?? null,
      ok: o.status === "sent",
      error: o.error ?? null,
    }));
  if (!rows.length) return;
  try {
    await prisma.notificationLog.createMany({ data: rows });
  } catch (err) {
    console.error("[notify] failed to record delivery log", err);
  }
}

/** 한 잡을 선점하고 1회 발송 시도. 결과에 따라 잡 상태를 굴린다. */
async function attemptJob(job: JobRow, now: Date): Promise<"sent" | "retrying" | "gave-up" | "skipped" | "lost"> {
  const attemptsMade = job.attempts + 1;
  const retryAt = nextAttemptAt(attemptsMade, now);
  const claimed = await prisma.notificationJob.updateMany({
    where: { id: job.id, status: "pending", attempts: job.attempts },
    data: {
      attempts: attemptsMade,
      // 마지막 시도라면 다음 시각은 의미 없지만, 크래시 대비로 넉넉히 둔다.
      nextAttemptAt: retryAt ?? new Date(now.getTime() + 600_000),
    },
  });
  if (claimed.count === 0) return "lost"; // 겹치는 틱이 이미 잡았다

  const { alert, ctx } = job.payload as unknown as JobPayload;
  const notifier = getNotifier(job.channel);

  if (!notifier || !notifier.isConfigured()) {
    // 설정이 사라졌다 — 재시도해도 소용없으니 바로 포기로 남긴다.
    const error = `채널 미설정 (${job.channel})`;
    await prisma.notificationJob.updateMany({
      where: { id: job.id },
      data: { status: "failed", lastError: error },
    });
    await recordNotifications(job.alertId, ctx, [
      { channel: job.channel, status: "failed", error },
    ]);
    return "gave-up";
  }

  try {
    const result = await notifier.notify(alert, ctx);
    if (result === "skipped") {
      await prisma.notificationJob.updateMany({
        where: { id: job.id },
        data: { status: "skipped" },
      });
      return "skipped";
    }
    await prisma.notificationJob.updateMany({
      where: { id: job.id },
      data: { status: "sent", lastError: null },
    });
    await recordNotifications(job.alertId, ctx, [
      { channel: job.channel, status: "sent" },
    ]);
    return "sent";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[notify:${job.channel}] attempt ${attemptsMade} failed`, err);
    if (attemptsMade >= MAX_ATTEMPTS) {
      await prisma.notificationJob.updateMany({
        where: { id: job.id },
        data: { status: "failed", lastError: message },
      });
      await recordNotifications(job.alertId, ctx, [
        {
          channel: job.channel,
          status: "failed",
          error: `${message} · ${MAX_ATTEMPTS}회 실패, 포기`,
        },
      ]);
      return "gave-up";
    }
    await prisma.notificationJob.updateMany({
      where: { id: job.id },
      data: { lastError: message },
    });
    return "retrying";
  }
}

export interface DrainResult {
  due: number;
  sent: number;
  retrying: number;
  gaveUp: number;
}

/** due가 된 pending 잡들을 민다. 틱 라우트와 인라인 1회 시도가 공유한다. */
export async function drainDueJobs(
  now = new Date(),
  limit = 50,
  ids?: string[],
): Promise<DrainResult> {
  const jobs = await prisma.notificationJob.findMany({
    where: {
      status: "pending",
      nextAttemptAt: { lte: now },
      ...(ids ? { id: { in: ids } } : {}),
    },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });
  const result: DrainResult = { due: jobs.length, sent: 0, retrying: 0, gaveUp: 0 };
  for (const job of jobs) {
    const outcome = await attemptJob(job, now);
    if (outcome === "sent") result.sent += 1;
    else if (outcome === "retrying") result.retrying += 1;
    else if (outcome === "gave-up") result.gaveUp += 1;
  }
  return result;
}

/**
 * 팬아웃 진입점: 설정된 채널마다 잡을 만들고 인라인으로 1회 즉시 시도한다.
 * 채널이 하나도 설정돼 있지 않으면 아무것도 만들지 않는다 (지금까지의
 * no-op 동작과 동일). 큐 조작 실패는 삼킨다 — 아웃박스가 ingest를 죽이면
 * 본말전도다.
 */
export async function enqueueAndSend(
  alertId: string,
  alert: NormalizedAlert,
  ctx: NotifyContext,
): Promise<void> {
  const channels = configuredChannels();
  if (channels.length === 0) return;
  try {
    const payload = { alert, ctx } as unknown as Prisma.InputJsonValue;
    const now = new Date();
    const created = await prisma.$transaction(
      channels.map((channel) =>
        prisma.notificationJob.create({
          data: { alertId, channel, payload, nextAttemptAt: now },
          select: { id: true },
        }),
      ),
    );
    await drainDueJobs(now, channels.length, created.map((j) => j.id));
  } catch (err) {
    console.error("[notify] outbox enqueue failed", err);
  }
}
