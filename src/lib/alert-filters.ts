import type { AlertStatus } from "@/lib/types";

// 대시보드 필터 (v0.3 §6.1). Kept pure — the page adapts each Alert row (+ its
// resolved ownership) into AlertFacts and this module decides visibility, so
// the combination rules are unit-testable without Prisma or JSX.

export const VALID_STATUSES: AlertStatus[] = [
  "FIRING",
  "ACKNOWLEDGED",
  "RESOLVED",
  "INSUFFICIENT_DATA",
];

export interface DashboardFilters {
  /** Customer id — matches via the alert's live chain (unmapped never match). */
  customer?: string;
  project?: string;
  /** Environment (prd/stg/…) from the mapped account. */
  env?: string;
  /** Multi-toggle: empty = all statuses. */
  statuses: AlertStatus[];
  /** Free-text search, case-insensitive, across the text-ish fields. */
  q?: string;
  /** 1순위 담당 contact id, or "none" for alerts with no primary. */
  assignee?: string;
  unmapped: boolean;
}

/** The slice of one alert the filters can see. */
export interface AlertFacts {
  status: string;
  title: string;
  resource?: string | null;
  metric?: string | null;
  namespace?: string | null;
  description?: string | null;
  accountId?: string | null;
  /** Live chain of the mapped account; null when unmapped or account-less. */
  chain?: {
    customerId: string;
    projectId: string;
    environment: string | null;
  } | null;
  /** 1순위 담당 (snapshot first, else live resolution); null = 미지정. */
  primary?: { id: string; name: string } | null;
}

export const UNASSIGNED = "none";

/** `status=FIRING,ACKNOWLEDGED` — unknown entries are dropped, not errors. */
export function parseStatusParam(raw: string | undefined): AlertStatus[] {
  if (!raw) return [];
  const seen = new Set<string>();
  return raw
    .split(",")
    .filter((s): s is AlertStatus =>
      (VALID_STATUSES as string[]).includes(s) && !seen.has(s) && Boolean(seen.add(s)),
    );
}

function matchesQuery(a: AlertFacts, q: string): boolean {
  const needle = q.toLowerCase();
  return [a.title, a.resource, a.metric, a.namespace, a.description, a.accountId]
    .filter((v): v is string => Boolean(v))
    .some((v) => v.toLowerCase().includes(needle));
}

export function matchesFilters(a: AlertFacts, f: DashboardFilters): boolean {
  if (f.statuses.length > 0 && !(f.statuses as string[]).includes(a.status)) {
    return false;
  }
  // Org filters go through the live chain: an unmapped alert has no customer,
  // so any org filter excludes it (미매핑 토글이 그 알람들의 전용 뷰다).
  if (f.customer && a.chain?.customerId !== f.customer) return false;
  if (f.project && a.chain?.projectId !== f.project) return false;
  if (f.env && a.chain?.environment !== f.env) return false;
  if (f.unmapped && !(a.accountId && !a.chain)) return false;
  if (f.q && !matchesQuery(a, f.q)) return false;
  if (f.assignee) {
    if (f.assignee === UNASSIGNED) {
      if (a.primary) return false;
    } else if (a.primary?.id !== f.assignee) {
      return false;
    }
  }
  return true;
}

/** Canonical query string for a filter state; "/" when nothing is active. */
export function dashboardHref(f: DashboardFilters): string {
  const p = new URLSearchParams();
  if (f.customer) p.set("customer", f.customer);
  if (f.project) p.set("project", f.project);
  if (f.env) p.set("env", f.env);
  if (f.statuses.length) p.set("status", f.statuses.join(","));
  if (f.q) p.set("q", f.q);
  if (f.assignee) p.set("assignee", f.assignee);
  if (f.unmapped) p.set("unmapped", "1");
  const qs = p.toString();
  return qs ? `/?${qs}` : "/";
}

export function anyFilterActive(f: DashboardFilters): boolean {
  return Boolean(
    f.customer ||
      f.project ||
      f.env ||
      f.statuses.length ||
      f.q ||
      f.assignee ||
      f.unmapped,
  );
}
