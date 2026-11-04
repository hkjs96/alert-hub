import { prisma } from "@/lib/prisma";
import { buildMetricWidget, probeWidget } from "@/lib/aws/graph";
import { signedGraphUrl } from "@/lib/aws/graph-url";
import { explainAwsError, isHubConfigured, metricWidgetPng } from "@/server/aws";
import { appUrl as publicAppUrl } from "@/lib/app-url";

// 알람 그래프. Slack 에는 서명된 이미지 주소(/api/g/<id>.png)를 본문 image 블록으로 넣고,
// Slack 이 그 주소에서 그림을 가져간다 — 발송을 늦추지 않고 스레드도 쓰지 않는다.
// 알람 상세 화면은 같은 PNG 를 스코프 검사 라우트로 받는다.

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

/** 통지 본문에 넣을 그래프 주소 — 읽기 역할이 연결된 계정만. 아니면 null(그래프 없이 발송). */
export async function graphUrlForAlert(alertId: string, accountId: string | null | undefined): Promise<string | null> {
  try {
    if (!(await readerFor(accountId))) return null;
    return signedGraphUrl(publicAppUrl(), alertId);
  } catch (err) {
    console.error("[graph] url failed", err);
    return null;
  }
}

/**
 * 알람 하나의 그래프 PNG. aroundFiring 이면 발화 시각 기준 고정 창(Slack — 나중에 다시
 * 불러와도 같은 그림), 아니면 지금부터 최근 3시간(상세 화면).
 */
export async function alertGraphPng(alertId: string, opts: { aroundFiring?: boolean } = {}): Promise<Uint8Array> {
  const alert = await prisma.alert.findUniqueOrThrow({
    where: { id: alertId },
    select: { title: true, accountId: true, region: true, raw: true, firstSeenAt: true },
  });
  const reader = await readerFor(alert.accountId);
  if (!reader) throw new Error("이 계정에 읽기 역할이 연결되지 않았습니다");
  const fired = await prisma.alertEvent.findFirst({
    where: { alertId, status: "FIRING" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const region = alert.region ?? "ap-northeast-2";
  const widget = buildMetricWidget({
    title: alert.title,
    region,
    raw: alert.raw,
    firedAt: fired?.createdAt ?? alert.firstSeenAt,
    aroundFiring: opts.aroundFiring,
  });
  if (!widget) throw new Error("그릴 수 있는 지표가 없는 알람입니다(수식 전용 등)");
  return metricWidgetPng({ ...reader, region, widget });
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

export type GraphStatus = { kind: "off"; reason: string } | { kind: "on" };

/** 알람 상세에 "왜 그래프가 없나"를 그대로 보여 주기 위한 진단. */
export async function graphStatusFor(alertId: string): Promise<GraphStatus> {
  const a = await prisma.alert.findUnique({ where: { id: alertId }, select: { accountId: true } });
  if (!a) return { kind: "off", reason: "알람 없음" };
  if (!isHubConfigured()) return { kind: "off", reason: "Vercel 환경변수 AWS_ROLE_ARN 이 없습니다 (안내 데스크 역할)" };
  if (!a.accountId) return { kind: "off", reason: "알람에 AWS 계정 ID 가 없습니다" };
  const map = await prisma.awsAccountMap.findUnique({
    where: { accountId: a.accountId },
    select: { readerRoleArn: true, service: { select: { project: { select: { customer: { select: { awsExternalId: true } } } } } } },
  });
  if (!map) return { kind: "off", reason: `계정 ${a.accountId} 이 매핑되지 않았습니다` };
  if (!map.service.project.customer.awsExternalId) return { kind: "off", reason: "고객사 ExternalId 가 발급되지 않았습니다 (계정 매핑 › 그래프 연결)" };
  if (!map.readerRoleArn) return { kind: "off", reason: "계정 매핑에 읽기 역할 ARN 이 저장되지 않았습니다 (그래프 연결)" };
  return { kind: "on" };
}
