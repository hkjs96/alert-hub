import { GetResourcesCommand, ResourceGroupsTaggingAPIClient } from "@aws-sdk/client-resource-groups-tagging-api";
import { identifiersOf, resourceArnOf } from "@/lib/aws/resource-name";
import { readerCredentials } from "@/server/aws";
import { readerFor } from "@/server/graph";

// 리소스 Name 태그 조회 (EC2·EBS·NAT·ELB·대상 그룹·RDS·ElastiCache·Lambda·ECS·DynamoDB·SQS·SNS·S3).
// 고객사 alert-hub-reader 에 tag:GetResources 가 있어야 한다(템플릿 2026-11-06 이후 — 스택 업데이트).
// 통지를 늦추지 않도록 1.5초만 기다린다. 이름이 있으면 1시간, 없음·권한 없음은 5분만 기억.

const HIT_TTL = 60 * 60_000;
const MISS_TTL = 5 * 60_000;
const TIMEOUT_MS = 1500;

export type NameLookup = { name: string | null; reason?: string };
const cache = new Map<string, NameLookup & { at: number }>();

export async function lookupResourceName(input: {
  accountId: string | null | undefined;
  region: string | null | undefined;
  resource: string | null | undefined;
}): Promise<NameLookup> {
  const region = input.region ?? "ap-northeast-2";
  const arn = resourceArnOf(input.resource, region, input.accountId);
  if (!arn || !input.resource) return { name: null, reason: "이름을 조회하지 않는 리소스 유형" };
  const hit = cache.get(arn);
  if (hit && Date.now() - hit.at < (hit.name ? HIT_TTL : MISS_TTL)) return { name: hit.name, reason: hit.reason };
  const reader = await readerFor(input.accountId).catch(() => null);
  if (!reader) return { name: null, reason: "이 계정에 AWS 연결(읽기 역할)이 없음" };
  let out: NameLookup;
  try {
    const lookup = (async () => {
      const credentials = await readerCredentials(reader.roleArn, reader.externalId);
      const client = new ResourceGroupsTaggingAPIClient({ region: arn.startsWith("arn:aws:s3:::") ? "us-east-1" : region, credentials });
      const res = await client.send(new GetResourcesCommand({ ResourceARNList: [arn] }));
      const tags = res.ResourceTagMappingList?.[0]?.Tags ?? [];
      return tags.find((t) => t.Key === "Name")?.Value?.trim() || null;
    })();
    const name = await Promise.race([
      lookup,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
    // 식별자와 똑같은 이름(예: RDS 이름 = 태그)이면 덧붙이지 않는다.
    const useful = name && !identifiersOf(input.resource).includes(name) ? name : null;
    out = useful ? { name: useful } : { name: null, reason: "Name 태그 없음" };
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e?.message === "timeout") return { name: null, reason: "조회 시간 초과" };
    const denied = /AccessDenied|UnauthorizedOperation|not authorized/i.test(`${e?.name} ${e?.message}`);
    out = {
      name: null,
      reason: denied
        ? "권한 없음 — 고객사 계정에서 스택 alert-hub-connect 를 최신 템플릿으로 업데이트하세요 (tag:GetResources)"
        : `조회 실패: ${e?.name ?? ""} ${e?.message ?? ""}`.trim(),
    };
    if (!denied) console.warn("[resource-name]", out.reason);
  }
  cache.set(arn, { ...out, at: Date.now() });
  return out;
}

export async function resourceNameFor(input: Parameters<typeof lookupResourceName>[0]): Promise<string | null> {
  return (await lookupResourceName(input)).name;
}
