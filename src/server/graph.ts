import { prisma } from "@/lib/prisma";
import { MAX_ATTEMPTS } from "@/lib/notify/backoff";
import { isBotConfigured, uploadImageToThread } from "@/lib/notify/slack-api";
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

/** pending 그래프를 민다 — 봇 메시지가 이미 나간 알람만(스레드에 붙여야 하니까). */
export async function drainGraphs(limit = 5): Promise<GraphDrainResult> {
  const result: GraphDrainResult = { due: 0, posted: 0, failed: 0 };
  if (!isHubConfigured() || !isBotConfigured()) return result;
  try {
    const rows = await prisma.alert.findMany({
      where: { graphState: "pending", slackMessages: { some: {} } },
      select: { id: true, title: true, graphAttempts: true, slackMessages: { select: { channel: true, ts: true } } },
      orderBy: { lastSeenAt: "asc" },
      take: limit,
    });
    result.due = rows.length;
    for (const row of rows) {
      // 선점: 겹치는 틱이 같은 알람을 두 번 올리지 않게.
      const claimed = await prisma.alert.updateMany({
        where: { id: row.id, graphState: "pending", graphAttempts: row.graphAttempts },
        data: { graphAttempts: row.graphAttempts + 1 },
      });
      if (!claimed.count) continue;
      try {
        const png = await alertGraphPng(row.id);
        for (const m of row.slackMessages) {
          await uploadImageToThread(m, png, { filename: "alarm-graph.png", title: `📈 ${row.title} — 최근 3시간` });
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
        if (gaveUp) result.failed++;
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
