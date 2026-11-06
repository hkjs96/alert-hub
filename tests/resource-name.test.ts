import { describe, expect, it } from "vitest";
import { displayResource, resourceArnOf } from "@/lib/aws/resource-name";
import { buildAlertBody } from "@/lib/notify/slack-format";
import type { NormalizedAlert } from "@/lib/types";

describe("resource name", () => {
  it("builds ARNs from alarm dimensions", () => {
    const r = "ap-northeast-2", a = "051360090293";
    expect(resourceArnOf("InstanceId=i-01f242ed571b12fe2", r, a)).toBe("arn:aws:ec2:ap-northeast-2:051360090293:instance/i-01f242ed571b12fe2");
    expect(resourceArnOf("LoadBalancer=app/web/abc123", r, a)).toBe("arn:aws:elasticloadbalancing:ap-northeast-2:051360090293:loadbalancer/app/web/abc123");
    expect(resourceArnOf("TargetGroup=targetgroup/tg/1,LoadBalancer=app/web/abc", r, a)).toBe("arn:aws:elasticloadbalancing:ap-northeast-2:051360090293:targetgroup/tg/1");
    expect(resourceArnOf("DBInstanceIdentifier=prod-db", r, a)).toBe("arn:aws:rds:ap-northeast-2:051360090293:db:prod-db");
    expect(resourceArnOf("ClusterName=c,ServiceName=s", r, a)).toBe("arn:aws:ecs:ap-northeast-2:051360090293:service/c/s");
    expect(resourceArnOf("FunctionName=fn", r, a)).toBe("arn:aws:lambda:ap-northeast-2:051360090293:function:fn");
    expect(resourceArnOf("Foo=bar", r, a)).toBeNull();
    expect(resourceArnOf(null, r, a)).toBeNull();
  });
  it("formats display", () => {
    expect(displayResource("InstanceId=i-1", "web-01")).toBe("web-01 (InstanceId=i-1)");
    expect(displayResource("InstanceId=i-1", null)).toBe("InstanceId=i-1");
  });
  it("shows Name above id in Slack fields", () => {
    const alert = { title: "T", severity: "UNKNOWN", source: "cloudwatch", resource: "InstanceId=i-01f242ed571b12fe2" } as unknown as NormalizedAlert;
    const withName = JSON.stringify(buildAlertBody(alert, { resourceName: "raemian-api-01" }).blocks);
    expect(withName).toContain("🖥️ *raemian-api-01*\\nInstanceId=i-01f242ed571b12fe2");
    expect(withName).toContain("T  ·  raemian-api-01");
    const without = JSON.stringify(buildAlertBody(alert, {}).blocks);
    expect(without).not.toContain("raemian-api-01");
  });
});
