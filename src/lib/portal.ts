/**
 * 고객사 포털 권한 — 순수 함수. 기본은 전부 읽기 전용이고, MSP 관리자가
 * 고객사마다 항목별로 쓰기를 켠다. 키는 DB 에 쉼표 구분 문자열로 저장된다.
 */

export const PORTAL_GRANTS = ["contacts", "silences", "channels"] as const;
export type PortalGrant = (typeof PORTAL_GRANTS)[number];

export const GRANT_LABELS: Record<PortalGrant, string> = {
  contacts: "담당자 관리",
  silences: "점검 창 등록",
  channels: "Slack 채널 관리",
};

export const GRANT_HINTS: Record<PortalGrant, string> = {
  contacts: "자기 회사 담당자를 추가·수정·비활성할 수 있습니다 (역할은 항상 조회 전용).",
  silences: "자기 회사 범위의 점검 창을 등록·해제할 수 있습니다 — 그 동안 통지가 멈춥니다.",
  channels: "자기 회사 Slack 통지 채널을 등록·삭제·테스트할 수 있습니다.",
};

export function isPortalGrant(v: unknown): v is PortalGrant {
  return typeof v === "string" && (PORTAL_GRANTS as readonly string[]).includes(v);
}

/** "contacts,silences" → ["contacts","silences"] (알 수 없는 키는 버린다). */
export function parseGrants(raw: string | null | undefined): PortalGrant[] {
  if (!raw) return [];
  const out: PortalGrant[] = [];
  for (const part of raw.split(",")) {
    const k = part.trim().toLowerCase();
    if (isPortalGrant(k) && !out.includes(k)) out.push(k);
  }
  return out.sort((a, b) => PORTAL_GRANTS.indexOf(a) - PORTAL_GRANTS.indexOf(b));
}

export function formatGrants(grants: PortalGrant[]): string | null {
  const g = parseGrants(grants.join(","));
  return g.length ? g.join(",") : null;
}

export function hasGrant(raw: string | null | undefined, grant: PortalGrant): boolean {
  return parseGrants(raw).includes(grant);
}

/** 사람이 읽는 요약: "담당자 관리 · 점검 창 등록" 또는 "읽기 전용". */
export function describeGrants(raw: string | null | undefined): string {
  const g = parseGrants(raw);
  return g.length ? g.map((k) => GRANT_LABELS[k]).join(" · ") : "읽기 전용";
}
