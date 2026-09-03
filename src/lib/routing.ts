// 라우팅 규칙 매처 — 순수 함수. 규칙은 고객사 단위, priority 오름차순(같으면
// 만든 순) 첫 매치가 이긴다. 조건이 비어 있으면 와일드카드. 패턴은 `*` 글롭,
// 대소문자 무시. severity는 쉼표 목록(정확 일치, 대소문자 무시).

export interface RoutingRuleLite {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  namespace: string | null;
  metric: string | null;
  severity: string | null;
  resource: string | null;
  serviceId: string | null;
  teamId: string;
}

export interface RoutingSubject {
  namespace?: string | null;
  metric?: string | null;
  severity?: string | null;
  resource?: string | null;
  serviceId?: string | null;
}

/** `*` 글롭. 빈 패턴은 전부 매치. 값이 없으면(null) 와일드카드 패턴에만 매치. */
export function globMatch(pattern: string | null | undefined, value: string | null | undefined): boolean {
  const p = (pattern ?? "").trim();
  if (!p || p === "*") return true;
  if (value == null) return false;
  const re = new RegExp(
    "^" + p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
    "i",
  );
  return re.test(value);
}

export function severityMatch(list: string | null | undefined, value: string | null | undefined): boolean {
  const items = (list ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!items.length) return true;
  if (!value) return false;
  return items.includes(value.toLowerCase());
}

export function ruleMatches(rule: RoutingRuleLite, s: RoutingSubject): boolean {
  if (!rule.enabled) return false;
  if (rule.serviceId && rule.serviceId !== (s.serviceId ?? null)) return false;
  return (
    globMatch(rule.namespace, s.namespace) &&
    globMatch(rule.metric, s.metric) &&
    severityMatch(rule.severity, s.severity) &&
    globMatch(rule.resource, s.resource)
  );
}

/** 첫 매치. 입력 순서는 생성 순이라고 가정하고 priority로만 안정 정렬한다. */
export function matchRoutingRule(rules: RoutingRuleLite[], s: RoutingSubject): RoutingRuleLite | null {
  const sorted = rules
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.priority - b.r.priority || a.i - b.i)
    .map((x) => x.r);
  return sorted.find((r) => ruleMatches(r, s)) ?? null;
}

/** 조건을 사람이 읽는 한 줄로. 아무 조건도 없으면 "모든 알람". */
export function describeConditions(r: Pick<RoutingRuleLite, "namespace" | "metric" | "severity" | "resource">): string {
  const parts = [
    r.namespace ? `namespace ${r.namespace}` : null,
    r.metric ? `metric ${r.metric}` : null,
    r.severity ? `severity ${r.severity}` : null,
    r.resource ? `resource ${r.resource}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "모든 알람";
}
