/**
 * 알람에서 바로 갈 수 있는 링크 — 순수 함수. Slack 본문과 알람 상세가 같은 목록을 쓴다.
 */

export interface AlertLink {
  label: string;
  url: string;
}

export interface RunbookRef {
  url: string | null;
  text: string | null;
  /** 어디서 왔나: "규칙 RDS → DB팀" / "서비스 이체API" */
  source: string;
}

/** 규칙 런북이 있으면 그것, 없으면 서비스 런북. 둘 다 비면 null. */
export function pickRunbook(
  rule: { name: string; runbookUrl: string | null; runbook: string | null } | null | undefined,
  service: { name: string; runbookUrl: string | null; runbook: string | null } | null | undefined,
): RunbookRef | null {
  if (rule && (rule.runbookUrl || rule.runbook)) {
    return { url: rule.runbookUrl, text: rule.runbook, source: `규칙 ${rule.name}` };
  }
  if (service && (service.runbookUrl || service.runbook)) {
    return { url: service.runbookUrl, text: service.runbook, source: `서비스 ${service.name}` };
  }
  return null;
}

/**
 * CloudWatch 알람 콘솔 URL. 지문이 `cw:arn:aws:cloudwatch:<region>:<acct>:alarm:<name>` 일 때만.
 * 콘솔은 로그인된 계정으로 열리므로 MSP 는 해당 고객사 계정으로 스위치한 뒤 눌러야 한다.
 */
export function cloudWatchAlarmUrl(fingerprint: string | null | undefined): string | null {
  if (!fingerprint || !fingerprint.startsWith("cw:arn:aws:cloudwatch:")) return null;
  const arn = fingerprint.slice(3);
  // arn:aws:cloudwatch:REGION:ACCOUNT:alarm:NAME (NAME 에 ':' 가 있을 수 있어 6번째부터 합친다)
  const parts = arn.split(":");
  if (parts.length < 7) return null;
  const region = parts[3];
  const name = parts.slice(6).join(":");
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(region) || !name) return null;
  return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:alarm/${encodeURIComponent(name)}`;
}

export function buildAlertLinks(input: { fingerprint?: string | null; runbook?: RunbookRef | null }): AlertLink[] {
  const out: AlertLink[] = [];
  if (input.runbook?.url) out.push({ label: `📖 런북 (${input.runbook.source})`, url: input.runbook.url });
  const cw = cloudWatchAlarmUrl(input.fingerprint);
  if (cw) out.push({ label: "🔎 CloudWatch 콘솔", url: cw });
  return out;
}

/** Slack mrkdwn 한 줄: "📖 <url|런북 (서비스 이체API)>  ·  🔎 <url|CloudWatch 콘솔>" */
export function linksLine(links: AlertLink[]): string | null {
  if (!links.length) return null;
  return links.map((l) => `<${l.url}|${l.label}>`).join("  ·  ");
}
