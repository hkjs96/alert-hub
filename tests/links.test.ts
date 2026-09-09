import { describe, expect, it } from "vitest";
import { buildAlertLinks, cloudWatchAlarmUrl, linksLine, pickRunbook } from "@/lib/links";

// 런북 · CloudWatch 딥링크 — 규칙 런북 > 서비스 런북, 지문에서 콘솔 URL.

describe("런북 선택", () => {
  const svc = { name: "이체API", runbookUrl: "https://wiki/svc", runbook: null };
  it("규칙 런북이 있으면 우선, 없으면 서비스", () => {
    expect(pickRunbook({ name: "RDS → DB팀", runbookUrl: "https://wiki/rds", runbook: null }, svc)?.source).toBe("규칙 RDS → DB팀");
    expect(pickRunbook({ name: "r", runbookUrl: null, runbook: null }, svc)?.url).toBe("https://wiki/svc");
    expect(pickRunbook(null, { name: "s", runbookUrl: null, runbook: null })).toBeNull();
  });
  it("본문만 있어도 런북으로 친다 (링크는 없음)", () => {
    const r = pickRunbook(null, { name: "s", runbookUrl: null, runbook: "## 절차" });
    expect(r).toEqual({ url: null, text: "## 절차", source: "서비스 s" });
  });
});

describe("CloudWatch 콘솔 URL", () => {
  it("cw: 지문의 ARN 에서 리전·알람 이름을 뽑는다 (이름의 ':' 유지, 인코딩)", () => {
    const u = cloudWatchAlarmUrl("cw:arn:aws:cloudwatch:ap-northeast-2:111122223333:alarm:SEV-1 prod-db CPU:high");
    expect(u).toBe(
      "https://ap-northeast-2.console.aws.amazon.com/cloudwatch/home?region=ap-northeast-2#alarmsV2:alarm/SEV-1%20prod-db%20CPU%3Ahigh",
    );
  });
  it("다른 소스·깨진 ARN 은 null", () => {
    expect(cloudWatchAlarmUrl("custom:Checkout latency:checkout-svc")).toBeNull();
    expect(cloudWatchAlarmUrl("cw:arn:aws:cloudwatch:bad-region:1:alarm:x")).toBeNull();
    expect(cloudWatchAlarmUrl("cw:arn:aws:cloudwatch:us-east-1")).toBeNull();
    expect(cloudWatchAlarmUrl(null)).toBeNull();
  });
});

describe("링크 목록 · Slack 한 줄", () => {
  it("런북 링크 + 콘솔 순, mrkdwn 링크로", () => {
    const links = buildAlertLinks({
      fingerprint: "cw:arn:aws:cloudwatch:ap-northeast-2:1:alarm:a",
      runbook: { url: "https://wiki/rds", text: null, source: "규칙 RDS → DB팀" },
    });
    expect(links.map((l) => l.label)).toEqual(["📖 런북 (규칙 RDS → DB팀)", "🔎 CloudWatch 콘솔"]);
    expect(linksLine(links)).toBe(
      "<https://wiki/rds|📖 런북 (규칙 RDS → DB팀)>  ·  <https://ap-northeast-2.console.aws.amazon.com/cloudwatch/home?region=ap-northeast-2#alarmsV2:alarm/a|🔎 CloudWatch 콘솔>",
    );
    expect(linksLine([])).toBeNull();
  });
  it("본문만 있는 런북은 링크가 없다", () => {
    expect(buildAlertLinks({ fingerprint: "custom:x", runbook: { url: null, text: "t", source: "s" } })).toEqual([]);
  });
});
