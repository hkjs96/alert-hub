/**
 * CloudWatch 그래프(GetMetricWidgetImage) — 순수 함수. 알람의 Trigger 로 위젯 정의를 만들고,
 * 역할 ARN·ExternalId 를 검증한다. AWS 호출은 src/server/aws.ts.
 */

import { isRecord, str } from "@/lib/normalize";

/** 고객사 계정에 만드는 읽기 역할 이름. 안내 데스크 역할의 권한 정책도 이 이름만 허용한다. */
export const READER_ROLE_NAME = "alert-hub-reader";

export interface RoleArn {
  accountId: string;
  name: string;
}

/** arn:aws:iam::123456789012:role/[path/]name → { accountId, name } */
export function parseRoleArn(arn: string | null | undefined): RoleArn | null {
  const m = (arn ?? "").trim().match(/^arn:aws(?:-[a-z]+)*:iam::(\d{12}):role\/(?:[\w+=,.@-]+\/)*([\w+=,.@-]{1,64})$/);
  return m ? { accountId: m[1], name: m[2] } : null;
}

export type RoleCheck = { ok: true; arn: string } | { ok: false; reason: string };

/**
 * 매핑된 계정의 역할인지 확인한다 — 다른 계정의 역할을 걸어 남의 그래프를 끌어오는 일을 막는다.
 * 역할 이름도 alert-hub-reader 여야 한다(안내 데스크 정책이 그 이름만 허용하므로 다르면 어차피 실패).
 */
export function checkReaderRole(arn: string, mappedAccountId: string): RoleCheck {
  const parsed = parseRoleArn(arn);
  if (!parsed) return { ok: false, reason: "역할 ARN 형식이 아닙니다 (arn:aws:iam::<12자리>:role/alert-hub-reader)" };
  if (parsed.accountId !== mappedAccountId) {
    return { ok: false, reason: `역할의 계정(${parsed.accountId})이 매핑된 계정(${mappedAccountId})과 다릅니다` };
  }
  if (parsed.name !== READER_ROLE_NAME) {
    return { ok: false, reason: `역할 이름은 ${READER_ROLE_NAME} 이어야 합니다 (지금: ${parsed.name})` };
  }
  return { ok: true, arn: arn.trim() };
}

/** 고객사별 ExternalId: 사람이 옮겨 적기 쉬운 형태, 추측 불가. */
export function newExternalId(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const hex = Array.from(random(16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `ah-${hex}`;
}

const STAT: Record<string, string> = {
  AVERAGE: "Average",
  SUM: "Sum",
  MINIMUM: "Minimum",
  MAXIMUM: "Maximum",
  SAMPLECOUNT: "SampleCount",
};

function statOf(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  return STAT[s.toUpperCase()] ?? (s || "Average");
}

function dimsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const d of raw) {
    if (!isRecord(d)) continue;
    const name = str(d.name) ?? str(d.Name);
    const value = str(d.value) ?? str(d.Value);
    if (name && value) out.push(name, value);
  }
  return out;
}

export interface WidgetInput {
  title: string;
  region: string;
  /** SNS 로 받은 알람 원문(raw) — Trigger 를 읽는다. */
  raw: unknown;
  firedAt: Date;
  /** 그래프 범위(시간). 기본 3시간. */
  hours?: number;
}

/**
 * 알람 Trigger → 위젯 정의. 단일 지표 알람과, 지표 수식 알람 중 MetricStat 선들을 지원한다.
 * 그릴 지표가 없으면 null(수식만 있는 알람 등).
 */
export function buildMetricWidget(input: WidgetInput): Record<string, unknown> | null {
  const raw = isRecord(input.raw) ? input.raw : null;
  const trigger = raw && isRecord(raw.Trigger) ? raw.Trigger : null;
  if (!trigger) return null;

  const metrics: unknown[][] = [];
  const ns = str(trigger.Namespace);
  const name = str(trigger.MetricName);
  if (ns && name) {
    const opts: Record<string, unknown> = { stat: statOf(trigger.Statistic ?? trigger.ExtendedStatistic) };
    if (typeof trigger.Period === "number") opts.period = trigger.Period;
    metrics.push([ns, name, ...dimsOf(trigger.Dimensions), opts]);
  } else if (Array.isArray(trigger.Metrics)) {
    for (const m of trigger.Metrics) {
      if (!isRecord(m) || !isRecord(m.MetricStat) || !isRecord(m.MetricStat.Metric)) continue;
      const metric = m.MetricStat.Metric;
      const mns = str(metric.Namespace);
      const mname = str(metric.MetricName);
      if (!mns || !mname) continue;
      const opts: Record<string, unknown> = { stat: statOf(m.MetricStat.Stat) };
      if (typeof m.MetricStat.Period === "number") opts.period = m.MetricStat.Period;
      const label = str(m.Label);
      if (label) opts.label = label;
      metrics.push([mns, mname, ...dimsOf(metric.Dimensions), opts]);
    }
  }
  if (!metrics.length) return null;

  const annotations: Record<string, unknown> = {
    vertical: [{ label: "발화", value: input.firedAt.toISOString(), color: "#d62728" }],
  };
  if (typeof trigger.Threshold === "number") {
    annotations.horizontal = [{ label: "임계값", value: trigger.Threshold, color: "#ff7f0e" }];
  }
  return {
    title: input.title.slice(0, 100),
    region: input.region,
    view: "timeSeries",
    stacked: false,
    metrics,
    annotations,
    start: `-PT${input.hours ?? 3}H`,
    end: "P0D",
    timezone: "+0900",
    width: 800,
    height: 320,
  };
}

/** 연결 확인용: 데이터가 없어도 그림은 나오는 빈 그래프 — 권한만 확인한다. */
export function probeWidget(region: string): Record<string, unknown> {
  return {
    title: "alert-hub 연결 확인",
    region,
    view: "timeSeries",
    metrics: [["AWS/EC2", "CPUUtilization", { stat: "Average" }]],
    start: "-PT1H",
    end: "P0D",
    timezone: "+0900",
    width: 600,
    height: 240,
  };
}
