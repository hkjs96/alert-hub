import { prisma } from "@/lib/prisma";
import { MAX_ATTEMPTS } from "@/lib/notify/backoff";
import type { Prisma } from "@prisma/client";
import { isBotConfigured, postThread, updateMessage, uploadImageToThread } from "@/lib/notify/slack-api";
import { buildAlertBlocks, type AlertMsgState, type AlertMsgStatus } from "@/lib/notify/slack-blocks";
import { storedBody } from "@/server/slack-sync";
import { getSetting, setSetting } from "@/server/settings";
import { buildMetricWidget, probeWidget } from "@/lib/aws/graph";
import { explainAwsError, isHubConfigured, metricWidgetPng } from "@/server/aws";

// 알람 그래프 — 발화 팬아웃 뒤 "pending", 통지 틱이 PNG 를 받아 봇 메시지 스레드에 올린다.
// 전부 best-effort: 그래프가 실패해도 통지·전이는 이미 끝났다.

interface ReaderTarget {
  roleArn: string;
  externalId: string;
}

/** 이 AWS 계정에 쓸 수 있는 읽기 역할 (역할 ARN + 고객사 ExternalId 둘 다 있어야). */
export async function readerFor(accountId: string | null | undefined): Promise<ReaderTarget | null> {
  if (!accountId || !isHubConfigured()) return null;
  const map = await prisma.awsAccountMap.findUnique({
    where: { accountId },
    select: { readerRoleArn: true, service: { select: { project: { select: { customer: { select: { awsExternalId: true } } } } } } },
  });
  const roleArn = map?.readerRoleArn;
  const externalId = map?.service.project.customer.awsExternalId;
  return roleArn && externalId ? { roleArn, externalId } : null;
}

/** FIRING 팬아웃 직후: 읽기 역할이 연결된 계정이면 그래프를 대기열에. */
export async function enqueueGraph(alertId: string, accountId: string | null | undefined): Promise<void> {
  try {
    if (!(await readerFor(accountId))) return;
    await prisma.alert.update({ where: { id: alertId }, data: { graphState: "pending", graphAttempts: 0, graphError: null } });
  } catch (err) {
    console.error("[graph] enqueue failed", err);
  }
}

/** 알람 하나의 그래프 PNG. 상세 화면 라우트와 Slack 첨부가 같이 쓴다. */
export async function alertGraphPng(alertId: string): Promise<Uint8Array> {
  const alert = await prisma.alert.findUniqueOrThrow({
    where: { id: alertId },
    select: { title: true, accountId: true, region: true, raw: true, lastSeenAt: true, firstSeenAt: true },
  });
  const reader = await readerFor(alert.accountId);
  if (!reader) throw new Error("이 계정에 읽기 역할이 연결되지 않았습니다");
  const fired = await prisma.alertEvent.findFirst({
    where: { alertId, status: "FIRING" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const region = alert.region ?? "ap-northeast-2";
  const widget = buildMetricWidget({ title: alert.title, region, raw: alert.raw, firedAt: fired?.createdAt ?? alert.firstSeenAt });
  if (!widget) throw new Error("그릴 수 있는 지표가 없는 알람입니다(수식 전용 등)");
  return metricWidgetPng({ ...reader, region, widget });
}

export interface GraphDrainResult {
  due: number;
  posted: number;
  failed: number;
}

export const GRAPH_PLACEMENT = "graph.placement";
export type GraphPlacement = "inline" | "thread";

/** 그래프 위치 — 기본은 메시지 본문 안(inline). 채널이 길어지면 시스템 진단에서 스레드로. */
export async function graphPlacement(): Promise<GraphPlacement> {
  return (await getSetting(GRAPH_PLACEMENT)) === "thread" ? "thread" : "inline";
}

export async function setGraphPlacement(v: GraphPlacement, by: string | null): Promise<void> {
  await setSetting(GRAPH_PLACEMENT, v, by);
}

const IMAGE_BLOCK_ID = "ah_graph";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 본문 블록 끝에 그래프 이미지 블록을 끼워 원래 메시지를 고친다. 저장된 본문도 갱신해서
 * 이후 확인·해결로 메시지가 다시 그려져도 그래프가 남게. Slack 이 방금 올린 파일을 처리하는
 * 동안 invalid_blocks 가 날 수 있어 짧게 몇 번 다시 시도한다.
 */
async function attachInline(
  m: { id: string; channel: string; ts: string; text: string; blocks: unknown },
  fileId: string,
  title: string,
  state: AlertMsgState,
): Promise<void> {
  const body = (storedBody(m.blocks) ?? []).filter((b) => b.block_id !== IMAGE_BLOCK_ID);
  const withImage = [
    ...body,
    { type: "image", block_id: IMAGE_BLOCK_ID, slack_file: { id: fileId }, alt_text: title, title: { type: "plain_text", text: title.slice(0, 2000), emoji: true } },
  ];
  let lastErr: unknown = null;
  for (let i = 0; i < 4; i++) {
    try {
      await updateMessage({ channel: m.channel, ts: m.ts }, m.text, buildAlertBlocks(m.text, state, withImage));
      await prisma.slackMessage.update({ where: { id: m.id }, data: { blocks: withImage as unknown as Prisma.InputJsonValue } });
      return;
    } catch (err) {
      lastErr = err;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

/**
 * pending 그래프를 민다 — 봇 메시지가 이미 나간 알람만. 기본은 메시지 본문 안에 끼워 넣고,
 * 그게 안 되면(옛 형식 메시지·끼워 넣기 실패·설정이 스레드) 스레드에 첨부한다.
 * ids 가 있으면 그 알람들만(통지 직후 바로 붙일 때).
 */
export async function drainGraphs(limit = 5, ids?: string[]): Promise<GraphDrainResult> {
  const result: GraphDrainResult = { due: 0, posted: 0, failed: 0 };
  if (!isHubConfigured() || !isBotConfigured()) return result;
  try {
    // 묶음 메시지로 나간 알람은 붙일 메시지가 없다 — 15분 넘게 기다리면 건너뜀으로 정리.
    await prisma.alert.updateMany({
      where: { graphState: "pending", slackMessages: { none: {} }, lastSeenAt: { lt: new Date(Date.now() - 15 * 60_000) } },
      data: { graphState: "skipped", graphError: "붙일 Slack 메시지가 없음 (묶음 통지 등)" },
    });
    const rows = await prisma.alert.findMany({
      where: { graphState: "pending", slackMessages: { some: {} }, ...(ids ? { id: { in: ids } } : {}) },
      select: {
        id: true, title: true, status: true, ackedBy: true, graphAttempts: true,
        slackMessages: { select: { id: true, channel: true, ts: true, text: true, blocks: true, createdAt: true } },
      },
      orderBy: { lastSeenAt: "asc" },
      take: limit,
    });
    result.due = rows.length;
    const placement = await graphPlacement();
    const appUrl = process.env.APP_URL ?? null;
    for (const row of rows) {
      // 선점: 겹치는 틱이 같은 알람을 두 번 올리지 않게.
      const claimed = await prisma.alert.updateMany({
        where: { id: row.id, graphState: "pending", graphAttempts: row.graphAttempts },
        data: { graphAttempts: row.graphAttempts + 1 },
      });
      if (!claimed.count) continue;
      try {
        const png = await alertGraphPng(row.id);
        // 이번 발화의 메시지에만 — 같은 알람의 지난 발화 메시지에 그래프가 붙지 않게.
        const fired = await prisma.alertEvent.findFirst({
          where: { alertId: row.id, status: "FIRING" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        const since = fired?.createdAt.getTime() ?? 0;
        const recent = row.slackMessages.filter((m) => m.createdAt.getTime() >= since - 5_000);
        const targets = recent.length ? recent : row.slackMessages.slice(-1);
        const title = `📈 ${row.title} — 최근 3시간`;
        const status = (row.status === "ACKNOWLEDGED" || row.status === "RESOLVED" ? row.status : "FIRING") as AlertMsgStatus;
        const state: AlertMsgState = { alertId: row.id, status, note: status === "ACKNOWLEDGED" ? row.ackedBy : null, appUrl };
        for (const m of targets) {
          const ref = { channel: m.channel, ts: m.ts };
          // 먼저 그 메시지 스레드에 올린다 — 대화에 공유된 파일이어야 본문 image 블록이 그려진다
          // (공유 안 된 비공개 파일은 chat.update 가 성공해도 그림이 비어 보였다).
          const sharedId = await uploadImageToThread(ref, png, { filename: "alarm-graph.png", title });
          if (placement === "inline" && storedBody(m.blocks)) {
            try {
              await attachInline(m, sharedId, title, state);
            } catch (err) {
              console.error(`[graph] inline attach failed for ${row.id} — thread copy stays`, err);
            }
          }
        }
        await prisma.alert.update({ where: { id: row.id }, data: { graphState: "done", graphError: null } });
        result.posted++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[graph] ${row.id} attempt ${row.graphAttempts + 1} failed`, err);
        const gaveUp = row.graphAttempts + 1 >= MAX_ATTEMPTS;
        await prisma.alert.update({
          where: { id: row.id },
          data: gaveUp ? { graphState: "failed", graphError: message } : { graphError: message },
        });
        if (gaveUp) {
          result.failed++;
          // Slack 만 보는 사람도 왜 그래프가 없는지 알게 — 스레드에 한 줄.
          const last = row.slackMessages[row.slackMessages.length - 1];
          if (last) {
            await postThread({ channel: last.channel, ts: last.ts }, `📈 그래프 첨부 실패 · ${message}`).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    console.error("[graph] drain failed", err);
  }
  return result;
}

/** 계정 매핑의 "연결 확인": 빈 그래프 한 장을 실제로 받아 본다. 결과는 매핑 행에 기록. */
export async function probeReader(accountMapId: string): Promise<{ ok: true; png: Uint8Array } | { ok: false; error: string }> {
  const map = await prisma.awsAccountMap.findUniqueOrThrow({
    where: { id: accountMapId },
    select: { readerRoleArn: true, service: { select: { project: { select: { customer: { select: { awsExternalId: true } } } } } } },
  });
  const externalId = map.service.project.customer.awsExternalId;
  let outcome: { ok: true; png: Uint8Array } | { ok: false; error: string };
  if (!isHubConfigured()) outcome = { ok: false, error: "AWS_ROLE_ARN 미설정 — Vercel 환경변수에 안내 데스크 역할 ARN 을 넣고 재배포하세요" };
  else if (!map.readerRoleArn) outcome = { ok: false, error: "읽기 역할 ARN 을 먼저 저장하세요" };
  else if (!externalId) outcome = { ok: false, error: "고객사 ExternalId 를 먼저 발급하세요" };
  else {
    try {
      const png = await metricWidgetPng({ roleArn: map.readerRoleArn, externalId, region: "ap-northeast-2", widget: probeWidget("ap-northeast-2") });
      outcome = { ok: true, png };
    } catch (err) {
      outcome = { ok: false, error: err instanceof Error ? err.message : explainAwsError(err) };
    }
  }
  await prisma.awsAccountMap.update({
    where: { id: accountMapId },
    data: { readerCheckedAt: new Date(), readerError: outcome.ok ? null : outcome.error },
  });
  return outcome;
}

export type GraphStatus =
  | { kind: "off"; reason: string }
  | { kind: "pending"; attempts: number; error: string | null }
  | { kind: "done" }
  | { kind: "failed"; error: string | null }
  | { kind: "skipped"; reason: string | null }
  | { kind: "idle" };

/** 알람 상세에 "왜 그래프가 없나"를 그대로 보여 주기 위한 진단. */
export async function graphStatusFor(alertId: string): Promise<GraphStatus> {
  const a = await prisma.alert.findUnique({
    where: { id: alertId },
    select: { accountId: true, graphState: true, graphAttempts: true, graphError: true },
  });
  if (!a) return { kind: "off", reason: "알람 없음" };
  if (!isHubConfigured()) return { kind: "off", reason: "Vercel 환경변수 AWS_ROLE_ARN 이 없습니다 (안내 데스크 역할)" };
  if (!a.accountId) return { kind: "off", reason: "알람에 AWS 계정 ID 가 없습니다" };
  const map = await prisma.awsAccountMap.findUnique({
    where: { accountId: a.accountId },
    select: { readerRoleArn: true, readerError: true, service: { select: { project: { select: { customer: { select: { awsExternalId: true } } } } } } },
  });
  if (!map) return { kind: "off", reason: `계정 ${a.accountId} 이 매핑되지 않았습니다` };
  if (!map.service.project.customer.awsExternalId) return { kind: "off", reason: "고객사 ExternalId 가 발급되지 않았습니다 (계정 매핑 › 그래프 연결)" };
  if (!map.readerRoleArn) return { kind: "off", reason: "계정 매핑에 읽기 역할 ARN 이 저장되지 않았습니다 (그래프 연결)" };
  if (a.graphState === "pending") return { kind: "pending", attempts: a.graphAttempts, error: a.graphError };
  if (a.graphState === "done") return { kind: "done" };
  if (a.graphState === "failed") return { kind: "failed", error: a.graphError };
  if (a.graphState === "skipped") return { kind: "skipped", reason: a.graphError };
  return { kind: "idle" };
}

/** 상세 화면의 "Slack 에 다시 올리기". */
export async function requeueGraph(alertId: string): Promise<void> {
  await prisma.alert.update({ where: { id: alertId }, data: { graphState: "pending", graphAttempts: 0, graphError: null } });
}
