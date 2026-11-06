import { DescribeTagsCommand, EC2Client } from "@aws-sdk/client-ec2";
import { ec2InstanceIdOf } from "@/lib/aws/resource-name";
import { readerCredentials } from "@/server/aws";
import { readerFor } from "@/server/graph";

// EC2 Name 태그 조회. 고객사 alert-hub-reader 에 ec2:DescribeTags 가 있어야 한다(템플릿 2026-11-06 이후).
// 통지를 늦추지 않도록 짧게 기다리고, 실패·권한 없음·시간 초과는 null (ID 만 표시).
// 결과(빈 값 포함)는 1시간 기억 — 같은 인스턴스 알람이 몰려도 조회는 한 번.

const TTL_MS = 60 * 60_000;
const TIMEOUT_MS = 1500;
const cache = new Map<string, { name: string | null; at: number }>();

export async function resourceNameFor(input: {
  accountId: string | null | undefined;
  region: string | null | undefined;
  resource: string | null | undefined;
}): Promise<string | null> {
  const instanceId = ec2InstanceIdOf(input.resource);
  if (!instanceId || !input.accountId) return null;
  const region = input.region ?? "ap-northeast-2";
  const key = `${input.accountId}|${region}|${instanceId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.name;
  try {
    const reader = await readerFor(input.accountId);
    if (!reader) return null;
    const lookup = (async () => {
      const credentials = await readerCredentials(reader.roleArn, reader.externalId);
      const ec2 = new EC2Client({ region, credentials });
      const res = await ec2.send(
        new DescribeTagsCommand({
          Filters: [
            { Name: "resource-id", Values: [instanceId] },
            { Name: "key", Values: ["Name"] },
          ],
        }),
      );
      return res.Tags?.[0]?.Value?.trim() || null;
    })();
    const name = await Promise.race([
      lookup,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
    cache.set(key, { name, at: Date.now() });
    return name;
  } catch (err) {
    // 권한 없음(스택 업데이트 전)은 조용히 — 1시간 동안 다시 묻지 않는다. 시간 초과는 기억하지 않는다.
    const e = err as { name?: string; message?: string };
    if (e?.message !== "timeout") cache.set(key, { name: null, at: Date.now() });
    if (e?.name !== "UnauthorizedOperation") console.warn("[resource-name]", e?.name ?? "", e?.message ?? err);
    return null;
  }
}
