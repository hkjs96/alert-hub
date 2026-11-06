import { describe, expect, it } from "vitest";
import { displayResource, ec2InstanceIdOf } from "@/lib/aws/resource-name";
import { buildAlertBody } from "@/lib/notify/slack-format";
import type { NormalizedAlert } from "@/lib/types";

describe("resource name", () => {
  it("extracts EC2 instance id", () => {
    expect(ec2InstanceIdOf("InstanceId=i-01f242ed571b12fe2")).toBe("i-01f242ed571b12fe2");
    expect(ec2InstanceIdOf("DBInstanceIdentifier=prod-db")).toBeNull();
    expect(ec2InstanceIdOf(null)).toBeNull();
  });
  it("formats display", () => {
    expect(displayResource("InstanceId=i-1", "web-01")).toBe("web-01 (InstanceId=i-1)");
    expect(displayResource("InstanceId=i-1", null)).toBe("InstanceId=i-1");
  });
  it("shows Name above id in Slack fields", () => {
    const alert = { title: "T", severity: "UNKNOWN", source: "cloudwatch", resource: "InstanceId=i-01f242ed571b12fe2" } as unknown as NormalizedAlert;
    const withName = JSON.stringify(buildAlertBody(alert, { resourceName: "raemian-api-01" }).blocks);
    expect(withName).toContain("*raemian-api-01*\\n`InstanceId=i-01f242ed571b12fe2`");
    const without = JSON.stringify(buildAlertBody(alert, {}).blocks);
    expect(without).not.toContain("raemian-api-01");
  });
});
