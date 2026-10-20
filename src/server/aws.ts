import { CloudWatchClient, GetMetricWidgetImageCommand } from "@aws-sdk/client-cloudwatch";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from "@smithy/types";

// alert-hub 의 AWS 신원과 고객사 읽기 역할로의 갈아타기.
//
//   alert-hub(Vercel) ──OIDC──▶ 안내 데스크 역할(AWS_ROLE_ARN, 메가존 계정)
//                     ──AssumeRole + ExternalId──▶ 고객사 alert-hub-reader ──▶ GetMetricWidgetImage
//
// Vercel 밖(로컬)에서는 기본 자격 증명 체인(프로필 등)으로 안내 데스크 역할을 빌린다.

export function hubRoleArn(): string | null {
  return process.env.AWS_ROLE_ARN?.trim() || null;
}

export function hubRegion(): string {
  return process.env.AWS_REGION?.trim() || "ap-northeast-2";
}

export function isHubConfigured(): boolean {
  return hubRoleArn() !== null;
}

let hubProvider: AwsCredentialIdentityProvider | null = null;

async function hubCredentials(): Promise<AwsCredentialIdentityProvider | undefined> {
  const roleArn = hubRoleArn();
  if (!roleArn) throw new Error("AWS_ROLE_ARN 미설정 — 안내 데스크 역할이 없습니다");
  if (!process.env.VERCEL) return undefined; // 로컬: 기본 체인이 바로 쓰인다
  if (!hubProvider) {
    const { awsCredentialsProvider } = await import("@vercel/functions/oidc");
    hubProvider = awsCredentialsProvider({ roleArn, roleSessionName: "alert-hub", clientConfig: { region: hubRegion() } });
  }
  return hubProvider;
}

// 고객사 역할 자격 증명 캐시 — 만료 5분 전까지 재사용(같은 서비스 알람이 몰려도 STS 한 번).
const readerCache = new Map<string, AwsCredentialIdentity>();

export async function readerCredentials(roleArn: string, externalId: string): Promise<AwsCredentialIdentity> {
  const key = `${roleArn}|${externalId}`;
  const hit = readerCache.get(key);
  if (hit?.expiration && hit.expiration.getTime() - Date.now() > 5 * 60_000) return hit;
  const sts = new STSClient({ region: hubRegion(), credentials: await hubCredentials() });
  const res = await sts.send(
    new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: "alert-hub-graph", ExternalId: externalId, DurationSeconds: 3600 }),
  );
  const c = res.Credentials;
  if (!c?.AccessKeyId || !c.SecretAccessKey) throw new Error("STS 가 자격 증명을 돌려주지 않았습니다");
  const creds: AwsCredentialIdentity = {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
    expiration: c.Expiration,
  };
  readerCache.set(key, creds);
  return creds;
}

/** 위젯 정의 → PNG. 실패는 사람이 읽을 메시지로 던진다. */
export async function metricWidgetPng(input: {
  roleArn: string;
  externalId: string;
  region: string;
  widget: Record<string, unknown>;
}): Promise<Uint8Array> {
  try {
    const credentials = await readerCredentials(input.roleArn, input.externalId);
    const cw = new CloudWatchClient({ region: input.region, credentials });
    const res = await cw.send(
      new GetMetricWidgetImageCommand({ MetricWidget: JSON.stringify(input.widget), OutputFormat: "png" }),
    );
    if (!res.MetricWidgetImage?.length) throw new Error("빈 이미지");
    return res.MetricWidgetImage;
  } catch (err) {
    throw new Error(explainAwsError(err));
  }
}

/** AWS 오류를 "어디를 고치면 되는지"로 바꿔 말한다. */
export function explainAwsError(err: unknown): string {
  const e = err as { name?: string; Code?: string; message?: string };
  const name = e?.name ?? e?.Code ?? "";
  const msg = e?.message ?? String(err);
  if (/AWS_ROLE_ARN/.test(msg)) return msg;
  if (/AssumeRoleWithWebIdentity|InvalidIdentityToken|OIDC|web identity/i.test(`${name} ${msg}`)) {
    return `안내 데스크 역할(AWS_ROLE_ARN)로 들어가지 못했습니다 — Vercel OIDC 설정과 역할 신뢰 정책(aud·sub)을 확인하세요. (${name || msg})`;
  }
  if (name === "AccessDenied" && /AssumeRole/i.test(msg)) {
    return `고객사 역할로 갈아타지 못했습니다 — 고객사 계정 alert-hub-reader 의 신뢰 정책(안내 데스크 역할 ARN · ExternalId)을 확인하세요. (${msg})`;
  }
  if (/GetMetricWidgetImage/i.test(msg) || name === "AccessDeniedException") {
    return `그래프 권한이 없습니다 — alert-hub-reader 역할에 cloudwatch:GetMetricWidgetImage 를 허용하세요. (${msg})`;
  }
  return `${name ? `${name}: ` : ""}${msg}`;
}
