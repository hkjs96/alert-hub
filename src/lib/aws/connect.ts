/**
 * "AWS 에 연결" — CloudFormation 빠른 생성 링크를 만든다(순수 함수). 고객사 계정에 로그인된
 * 콘솔에서 이 링크를 열고 "스택 생성" 한 번이면 SNS 구독 + 그래프용 읽기 역할이 생긴다.
 * 템플릿: public/cfn/alert-hub-connect.yaml (S3 에 한 번 올려 CFN_TEMPLATE_URL 로).
 */
import { READER_ROLE_NAME } from "@/lib/aws/graph";

export const STACK_NAME = "alert-hub-connect";

/** 역할 이름이 고정이라 ARN 은 계정 ID 로 정해진다 — 스택이 만든 역할을 따로 입력할 필요가 없다. */
export function readerRoleArnFor(accountId: string): string {
  return `arn:aws:iam::${accountId}:role/${READER_ROLE_NAME}`;
}

/** arn:aws:sns:<region>:<account>:<name> 검사 + 계정이 매핑된 계정과 같아야. */
export function checkExistingTopic(arn: string, accountId: string): { ok: true; region: string } | { ok: false; reason: string } {
  const m = arn.trim().match(/^arn:aws:sns:([a-z0-9-]+):(\d{12}):[\w-]{1,256}$/);
  if (!m) return { ok: false, reason: "SNS 주제 ARN 형식이 아닙니다 (arn:aws:sns:<리전>:<계정>:<이름>)" };
  if (m[2] !== accountId) return { ok: false, reason: `주제의 계정(${m[2]})이 이 매핑의 계정(${accountId})과 다릅니다` };
  return { ok: true, region: m[1] };
}

export interface QuickCreateInput {
  templateUrl: string;
  region: string;
  ingestUrl: string;
  hubRoleArn: string;
  externalId: string;
  existingTopicArn?: string | null;
  createReaderRole: boolean;
}

export function quickCreateUrl(i: QuickCreateInput): string {
  const q = new URLSearchParams({
    templateURL: i.templateUrl,
    stackName: STACK_NAME,
    param_IngestUrl: i.ingestUrl,
    param_HubRoleArn: i.hubRoleArn,
    param_ExternalId: i.externalId,
    param_ExistingTopicArn: i.existingTopicArn ?? "",
    param_CreateReaderRole: i.createReaderRole ? "true" : "false",
  });
  return `https://${i.region}.console.aws.amazon.com/cloudformation/home?region=${i.region}#/stacks/quickcreate?${q.toString()}`;
}
