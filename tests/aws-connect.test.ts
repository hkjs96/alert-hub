import { describe, expect, it } from "vitest";
import { checkExistingTopic, quickCreateUrl, readerRoleArnFor, STACK_NAME } from "@/lib/aws/connect";
import { readFileSync } from "node:fs";

describe("AWS 원클릭 연결", () => {
  it("역할 ARN 은 계정으로 정해진다", () => {
    expect(readerRoleArnFor("771283576189")).toBe("arn:aws:iam::771283576189:role/alert-hub-reader");
  });
  it("기존 주제는 그 계정 것만, 리전은 주제에서", () => {
    expect(checkExistingTopic("arn:aws:sns:ap-northeast-1:771283576189:ops", "771283576189")).toEqual({ ok: true, region: "ap-northeast-1" });
    expect(checkExistingTopic("arn:aws:sns:ap-northeast-2:111122223333:ops", "771283576189")).toMatchObject({ ok: false });
    expect(checkExistingTopic("ops", "771283576189")).toMatchObject({ ok: false });
  });
  it("빠른 생성 링크: 리전 콘솔 + 템플릿 + 파라미터", () => {
    const url = new URL(
      quickCreateUrl({
        templateUrl: "https://s3.ap-northeast-2.amazonaws.com/mz-alert-hub/alert-hub-connect.yaml",
        region: "ap-northeast-2",
        ingestUrl: "https://hub.example/api/webhooks/cloudwatch?token=in_" + "a".repeat(40),
        hubRoleArn: "arn:aws:iam::999988887777:role/alert-hub-vercel",
        externalId: "ah-" + "b".repeat(32),
        createReaderRole: true,
      }),
    );
    expect(url.host).toBe("ap-northeast-2.console.aws.amazon.com");
    const q = new URLSearchParams(url.hash.split("?")[1]);
    expect(q.get("stackName")).toBe(STACK_NAME);
    expect(q.get("templateURL")).toContain("alert-hub-connect.yaml");
    expect(q.get("param_IngestUrl")).toContain("?token=in_");
    expect(q.get("param_ExistingTopicArn")).toBe("");
    expect(q.get("param_CreateReaderRole")).toBe("true");
  });
  it("템플릿의 파라미터 이름이 링크와 맞는다", () => {
    const yaml = readFileSync("public/cfn/alert-hub-connect.yaml", "utf8");
    for (const p of ["IngestUrl", "HubRoleArn", "ExternalId", "ExistingTopicArn", "CreateReaderRole"]) expect(yaml).toContain(`  ${p}:\n`);
    expect(yaml).toContain("RoleName: alert-hub-reader");
    expect(yaml).toContain("sts:ExternalId: !Ref ExternalId");
  });
});
