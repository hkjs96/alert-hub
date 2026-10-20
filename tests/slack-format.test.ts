import { describe, expect, it } from "vitest";
import { buildAlertBody, comparisonSymbol, formatNumber, parseDatapoints, sparkline } from "@/lib/notify/slack-format";
import { buildAlertBlocks } from "@/lib/notify/slack-blocks";
import type { NormalizedAlert } from "@/lib/types";

// Slack 알람 본문 — 제목·필드·최근 값 흐름. 텍스트 벽 대신 한눈에.

const REASON =
  "Threshold Crossed: 3 out of the last 3 datapoints [97.5 (20/10/26 05:55:00), 91.2 (20/10/26 05:54:00), 88.0 (20/10/26 05:53:00)] was greater than the threshold (90.0) (minimum 3 datapoints for OK -> ALARM transition).";

const alert: NormalizedAlert = {
  fingerprint: "cw:arn",
  title: "TEST-ALARM",
  source: "cloudwatch",
  severity: "UNKNOWN",
  status: "FIRING",
  resource: "InstanceId=i-099ec32a21de88457",
  metric: "CPUUtilization",
  namespace: "AWS/EC2",
  threshold: 90,
  comparison: "GreaterThanThreshold",
  region: "ap-northeast-2",
  accountId: "771283576189",
  stateReason: REASON,
};

describe("데이터 포인트·스파크라인", () => {
  it("사유 문구에서 값을 시간순(오래된 → 최신)으로 읽는다", () => {
    expect(parseDatapoints(REASON).map((p) => p.value)).toEqual([88, 91.2, 97.5]);
    expect(parseDatapoints(REASON)[2].at).toBe("20/10/26 05:55:00");
    expect(parseDatapoints("1.0449861821038753 (20/10/26 05:53:00)")).toEqual([]);
    expect(parseDatapoints("datapoints [1.0449861821038753 (20/10/26 05:53:00)]")).toEqual([{ value: 1.0449861821038753, at: "20/10/26 05:53:00" }]);
    expect(parseDatapoints(null)).toEqual([]);
  });
  it("값이 둘 이상일 때만 선을 그린다", () => {
    expect(sparkline([88, 91.2, 97.5])).toBe("▁▃█");
    expect(sparkline([5, 5])).toBe("▄▄");
    expect(sparkline([1])).toBeNull();
  });
  it("숫자·비교 기호", () => {
    expect(formatNumber(1.0449861821038753)).toBe("1.04");
    expect(formatNumber(97.5)).toBe("97.5");
    expect(formatNumber(12345.6)).toBe("12,346");
    expect(comparisonSymbol("GreaterThanThreshold")).toBe(">");
    expect(comparisonSymbol(undefined)).toBeNull();
  });
});

describe("본문 블록", () => {
  const { text, blocks } = buildAlertBody(alert, {
    alertId: "a1",
    chainLabel: "삼성물산건설 › 홈닉 › 홈닉",
    assignees: [{ name: "박지수", slackId: "U1" }, { name: "김도윤" }],
    history: "🕘 이전 처리 기록 없음 · 처음 보는 알람",
    links: [{ label: "🔎 CloudWatch 콘솔", url: "https://console.aws.amazon.com/x" }],
  });
  const json = JSON.stringify(blocks);

  it("제목은 header, 조직·담당은 한 섹션", () => {
    expect(blocks[0]).toEqual({ type: "header", text: { type: "plain_text", text: "⚠️ TEST-ALARM", emoji: true } });
    expect(JSON.stringify(blocks[1])).toContain("*삼성물산건설 › 홈닉 › 홈닉*\\n담당 1순위 <@U1>  ·  다음 김도윤");
  });
  it("2열 필드: 지표 · 현재값/임계값 · 리소스 · 계정/리전 · 심각도", () => {
    const fields = (blocks[2] as { fields: { text: string }[] }).fields.map((f) => f.text);
    expect(fields).toEqual([
      "*지표*\nAWS/EC2 · CPUUtilization",
      "*현재값 / 임계값*\n*97.5*  > 90",
      "*리소스*\n`InstanceId=i-099ec32a21de88457`",
      "*계정 · 리전*\n771283576189 · ap-northeast-2",
      "*심각도*\n미지정",
    ]);
  });
  it("최근 값 흐름 · 짧아진 사유 · 이전 처리 · 링크", () => {
    expect(json).toContain("📈 최근 3개 값  `▁▃█`  88 → 91.2 → 97.5");
    expect(json).not.toContain("minimum 3 datapoints");
    expect(json).toContain("이전 처리 기록 없음");
    expect(json).toContain("CloudWatch 콘솔");
  });
  it("알림 미리보기용 텍스트는 한 줄", () => {
    expect(text).toBe("⚠️ TEST-ALARM — FIRING · 삼성물산건설 › 홈닉 › 홈닉 · 97.5 > 90");
  });
  it("상태가 바뀌어도 본문은 그대로, 아래 상태 줄·버튼만 바뀐다", () => {
    const firing = buildAlertBlocks(text, { alertId: "a1", status: "FIRING" }, blocks);
    const resolved = buildAlertBlocks(text, { alertId: "a1", status: "RESOLVED", note: "박지수 · Slack" }, blocks);
    expect(firing.slice(0, blocks.length)).toEqual(blocks);
    expect(resolved.slice(0, blocks.length)).toEqual(blocks);
    expect(JSON.stringify(firing)).toContain("발화 중");
    expect(JSON.stringify(resolved)).toContain("✅ *해결됨* · 박지수 · Slack");
    expect(JSON.stringify(resolved)).not.toContain("ah_ack");
  });
});
