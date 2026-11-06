"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/auth";
import { checkReaderRole, newExternalId } from "@/lib/aws/graph";

function backOf(formData: FormData): string {
  const b = String(formData.get("back") ?? "");
  return b.startsWith("/") ? b : "/admin/org";
}

/** 고객사 ExternalId 발급(없을 때만). 이미 있으면 그대로 — 바꾸면 고객사 역할도 고쳐야 하므로. */
export async function issueExternalId(formData: FormData) {
  await requireRole("ADMIN");
  const customerId = String(formData.get("customerId") ?? "");
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: customerId }, select: { awsExternalId: true } });
  if (!c.awsExternalId) await prisma.customer.update({ where: { id: customerId }, data: { awsExternalId: newExternalId() } });
  revalidatePath(backOf(formData));
}

/** 계정 매핑에 읽기 역할 ARN 저장(비우면 연결 해제). 다른 계정의 역할은 거부. */
export async function saveReaderRole(formData: FormData) {
  await requireRole("ADMIN");
  const id = String(formData.get("accountMapId") ?? "");
  const raw = String(formData.get("roleArn") ?? "").trim();
  const map = await prisma.awsAccountMap.findUniqueOrThrow({ where: { id }, select: { accountId: true } });
  const back = backOf(formData);
  if (!raw) {
    await prisma.awsAccountMap.update({ where: { id }, data: { readerRoleArn: null, readerError: null, readerCheckedAt: null } });
    revalidatePath(back);
    return;
  }
  const check = checkReaderRole(raw, map.accountId);
  if (!check.ok) redirect(`${back}${back.includes("?") ? "&" : "?"}awsErr=${encodeURIComponent(check.reason)}#aws-${id}`);
  await prisma.awsAccountMap.update({ where: { id }, data: { readerRoleArn: check.arn, readerError: null, readerCheckedAt: null } });
  revalidatePath(back);
}

/**
 * "AWS 에 연결": 전용 토큰·ExternalId 를 보장하고, 읽기 역할 ARN 을 미리 채운 뒤
 * CloudFormation 빠른 생성 화면으로 보낸다. 기존 주제 ARN 을 주면 그 주제에 구독만 추가.
 */
export type ConnectState = { url: string; at: number } | { error: string; at: number } | null;

export async function connectAws(_prev: ConnectState, formData: FormData): Promise<ConnectState> {
  await requireRole("ADMIN");
  const { checkExistingTopic, quickCreateUrl, readerRoleArnFor } = await import("@/lib/aws/connect");
  const { cfnTemplateUrl, ensureConnectSecrets } = await import("@/server/connect");
  const { hubRoleArn } = await import("@/server/aws");
  const { appUrl } = await import("@/lib/app-url");
  const at = Date.now();
  const fail = (error: string): ConnectState => ({ error, at });
  const id = String(formData.get("accountMapId") ?? "");
  const map = await prisma.awsAccountMap.findUnique({
    where: { id },
    select: { accountId: true, readerRoleArn: true, service: { select: { project: { select: { customerId: true } } } } },
  });
  if (!map) return fail("계정 매핑을 찾을 수 없습니다");
  const topicRaw = String(formData.get("existingTopicArn") ?? "").trim();
  let region = String(formData.get("region") ?? "ap-northeast-2").trim() || "ap-northeast-2";
  if (topicRaw) {
    const t = checkExistingTopic(topicRaw, map.accountId);
    if (!t.ok) return fail(t.reason);
    region = t.region;
  }
  const hub = hubRoleArn();
  if (!hub) return fail("AWS_ROLE_ARN 미설정 — 안내 데스크 역할 ARN 을 Vercel 환경변수에 넣고 재배포하세요");
  const base = appUrl();
  if (!base) return fail("공개 주소를 알 수 없습니다 (APP_URL)");
  const templateUrl = cfnTemplateUrl();
  if (!templateUrl) return fail("CFN_TEMPLATE_URL 미설정 — Vercel 환경변수에 템플릿 S3 주소를 넣고 재배포하세요");
  const secrets = await ensureConnectSecrets(map.service.project.customerId);
  const createRole = formData.get("createRole") !== "off";
  if (createRole && !map.readerRoleArn) {
    await prisma.awsAccountMap.update({
      where: { id },
      data: { readerRoleArn: readerRoleArnFor(map.accountId), readerError: null, readerCheckedAt: null },
    });
  }
  return {
    at,
    url: quickCreateUrl({
      templateUrl,
      region,
      ingestUrl: `${base}/api/webhooks/cloudwatch?token=${secrets.ingestToken}`,
      hubRoleArn: hub,
      externalId: secrets.awsExternalId,
      existingTopicArn: topicRaw || null,
      createReaderRole: createRole,
    }),
  };
}
