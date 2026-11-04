import { prisma } from "@/lib/prisma";
import { newExternalId } from "@/lib/aws/graph";
import { newIngestToken } from "@/lib/ingest-guard";

/**
 * 고객사 연결에 필요한 값(전용 수신 토큰 · ExternalId)을 없으면 만들어 돌려준다 — 사람이 버튼을 누를
 * 필요가 없게. 이미 있으면 그대로(바꾸면 고객사 쪽 구독·역할도 바꿔야 하므로).
 */
export async function ensureConnectSecrets(customerId: string): Promise<{ ingestToken: string; awsExternalId: string }> {
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: customerId }, select: { ingestToken: true, awsExternalId: true } });
  if (c.ingestToken && c.awsExternalId) return { ingestToken: c.ingestToken, awsExternalId: c.awsExternalId };
  const updated = await prisma.customer.update({
    where: { id: customerId },
    data: {
      ...(c.ingestToken ? {} : { ingestToken: newIngestToken() }),
      ...(c.awsExternalId ? {} : { awsExternalId: newExternalId() }),
    },
    select: { ingestToken: true, awsExternalId: true },
  });
  return { ingestToken: updated.ingestToken!, awsExternalId: updated.awsExternalId! };
}

/** 템플릿 S3 주소 — 메가존 계정 S3 에 public/cfn/alert-hub-connect.yaml 을 올린 공개 주소. */
export function cfnTemplateUrl(): string | null {
  return process.env.CFN_TEMPLATE_URL?.trim() || null;
}
