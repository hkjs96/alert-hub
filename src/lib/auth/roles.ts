// 역할·계정 상태 — 순수 상수와 판정. 화면 라벨도 여기서 한 번만 정한다.

export type Role = "ADMIN" | "OPERATOR" | "VIEWER";
export type AccountStatus = "PENDING" | "ACTIVE" | "REJECTED";

export const ROLES: Role[] = ["ADMIN", "OPERATOR", "VIEWER"];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "관리자",
  OPERATOR: "온콜 엔지니어",
  VIEWER: "조회 전용",
};

export const ROLE_HINTS: Record<Role, string> = {
  ADMIN: "등록 관리 전체 · 가입 승인 · 알람 처리",
  OPERATOR: "알람 Ack/Resolve · 점검 창 · 자기 프로필",
  VIEWER: "대시보드 · 상세 조회만",
};

export const STATUS_LABELS: Record<AccountStatus, string> = {
  PENDING: "승인 대기",
  ACTIVE: "활성",
  REJECTED: "거절됨",
};

const RANK: Record<Role, number> = { VIEWER: 0, OPERATOR: 1, ADMIN: 2 };

/** role 이 min 이상인가. */
export function atLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as string[]).includes(v);
}
