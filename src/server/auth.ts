import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { readAuthConfig } from "@/lib/auth/config";
import { atLeast, type AccountStatus, type Role } from "@/lib/auth/roles";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "@/lib/auth/session";

export type AuthMode = "open" | "sso";

/** SSO가 연결돼 있으면 "sso", 아니면 "open"(로그인 없이 누구나 — 관리자 진단에 표시). */
export function authMode(): AuthMode {
  return readAuthConfig().enabled ? "sso" : "open";
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  department: string | null;
  slackId: string | null;
  phone: string | null;
  role: Role;
  status: AccountStatus;
  onboardedAt: Date | null;
  timezone: string | null;
  createdAt: Date;
  approvalPingAt: Date | null;
  /** 통지 프로필이 비어 있으면 헤더가 /me 로 유도한다. */
  profileIncomplete: boolean;
  /** 세션 만료(epoch 초). */
  sessionExp: number;
}

/** 쿠키만 본 세션(DB 조회 없음). 미들웨어와 같은 검증. */
export async function getSession(): Promise<SessionPayload | null> {
  const cfg = readAuthConfig();
  if (!cfg.enabled) return null;
  return verifySession(cookies().get(SESSION_COOKIE)?.value, cfg.secret);
}

/**
 * 세션 → DB의 내부 인원. 비활성·거절·고객사 담당자는 null — 서버 세션 테이블
 * 없이도 "즉시 차단"이 되는 이유다. 승인 대기(PENDING)는 status 로 돌려주며,
 * 앱 셸이 /pending 으로 보낸다.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const s = await getSession();
  if (!s) return null;
  const c = await prisma.contact.findUnique({ where: { id: s.sub } });
  if (!c || !c.active || c.customerId !== null || c.status === "REJECTED") return null;
  return {
    id: c.id,
    name: c.name,
    email: c.email ?? s.email,
    department: c.department,
    slackId: c.slackId,
    phone: c.phone,
    role: c.role,
    status: c.status,
    onboardedAt: c.onboardedAt,
    timezone: c.timezone,
    createdAt: c.createdAt,
    approvalPingAt: c.approvalPingAt,
    profileIncomplete: !c.slackId && !c.phone,
    sessionExp: s.exp,
  };
}

/** 액션에서 "누가"를 남길 때. 인증이 꺼져 있으면 null. */
export async function currentActorName(): Promise<string | null> {
  const u = await getCurrentUser();
  return u && u.status === "ACTIVE" ? u.name : null;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly kind: "unauthenticated" | "forbidden",
  ) {
    super(message);
  }
}

/**
 * 서버 액션 가드. SSO가 열린(open) 모드면 통과 — 지금까지의 동작 그대로.
 * SSO 모드에서는 활성 계정이고 역할이 min 이상이어야 한다. 폼을 조작해도
 * 권한 밖 작업은 여기서 막힌다.
 */
export async function requireRole(min: Role): Promise<CurrentUser | null> {
  if (authMode() === "open") return null;
  const u = await getCurrentUser();
  if (!u || u.status !== "ACTIVE") throw new AuthError("로그인이 필요합니다", "unauthenticated");
  if (!atLeast(u.role, min)) throw new AuthError(`이 작업은 ${min} 권한이 필요합니다`, "forbidden");
  return u;
}

/** 화면용: 조회 전용(VIEWER)이거나 세션이 없으면 true. open 모드면 false. */
export async function isReadOnly(): Promise<boolean> {
  if (authMode() === "open") return false;
  const u = await getCurrentUser();
  return !u || u.status !== "ACTIVE" || !atLeast(u.role, "OPERATOR");
}

/** 자기 프로필 수정 등 — 활성 계정이면 역할 무관. open 모드면 null. */
export async function requireUser(): Promise<CurrentUser | null> {
  return requireRole("VIEWER");
}

/** 승인 대기 상태도 허용(승인 요청 알림 등). SSO 모드에서 세션 없으면 throw. */
export async function requireSessionUser(): Promise<CurrentUser | null> {
  if (authMode() === "open") return null;
  const u = await getCurrentUser();
  if (!u) throw new AuthError("로그인이 필요합니다", "unauthenticated");
  return u;
}

export type JitResult =
  | { ok: true; contactId: string; created: boolean; status: AccountStatus; onboarded: boolean }
  | { ok: false; reason: "inactive" | "customer" | "rejected" };

/**
 * JIT 프로비저닝: 이메일로 내부 인원을 찾고, 없으면 만든다.
 * - 고객사 담당자 이메일 → 거부("customer"). 비활성 → "inactive". 거절 → "rejected".
 * - 새 계정은 승인 대기(PENDING)로 만든다. 단 AUTH_BOOTSTRAP_ADMINS 에 있는
 *   이메일은 바로 ADMIN·활성 — 첫 관리자를 만드는 길. 이미 PENDING 인 사람이
 *   부트스트랩 목록에 오르면 승격한다.
 * - 관리자가 화면에서 미리 등록한 사람(ACTIVE)은 그 행에 붙는다 = 초대.
 * - 이름이 비어 있던 행은 Google 이름으로 채운다(사용자가 바꾼 이름은 유지).
 */
export async function provisionInternalContact(p: {
  email: string;
  name: string;
  now?: Date;
}): Promise<JitResult> {
  const now = p.now ?? new Date();
  const cfg = readAuthConfig();
  // 관리자가 한 명도 없으면 첫 로그인이 관리자 — 허용 목록이 이미 문을 지키므로
  // 잠긴 채 시작하는 것보다 낫다. 진단 화면이 이 상태를 경고한다.
  const noAdmin = (await countActiveAdmins()) === 0;
  const bootstrap = cfg.bootstrapAdmins.includes(p.email.toLowerCase()) || noAdmin;

  const existing = await prisma.contact.findFirst({
    where: { email: { equals: p.email, mode: "insensitive" } },
    orderBy: [{ customerId: "asc" }, { createdAt: "asc" }], // 내부(null) 우선
  });
  if (existing) {
    if (existing.customerId !== null) return { ok: false, reason: "customer" };
    if (!existing.active) return { ok: false, reason: "inactive" };
    if (existing.status === "REJECTED" && !bootstrap) return { ok: false, reason: "rejected" };
    const promote = bootstrap && (existing.status !== "ACTIVE" || existing.role !== "ADMIN");
    const autoActivate = !promote && cfg.autoApprove && existing.status === "PENDING";
    const updated = await prisma.contact.update({
      where: { id: existing.id },
      data: {
        lastLoginAt: now,
        ...(existing.name.trim() ? {} : { name: p.name }),
        ...(promote
          ? { role: "ADMIN", status: "ACTIVE", approvedAt: now, approvedBy: noAdmin ? "first-login" : "bootstrap" }
          : autoActivate
            ? { status: "ACTIVE", approvedAt: now, approvedBy: "auto" }
            : {}),
      },
    });
    return {
      ok: true,
      contactId: updated.id,
      created: false,
      status: updated.status,
      onboarded: Boolean(updated.onboardedAt),
    };
  }
  const created = await prisma.contact.create({
    data: {
      name: p.name,
      email: p.email,
      customerId: null,
      lastLoginAt: now,
      ...(bootstrap
        ? { role: "ADMIN", status: "ACTIVE", approvedAt: now, approvedBy: noAdmin ? "first-login" : "bootstrap" }
        : cfg.autoApprove
          ? { role: "OPERATOR", status: "ACTIVE", approvedAt: now, approvedBy: "auto" }
          : { role: "OPERATOR", status: "PENDING" }),
    },
  });
  return { ok: true, contactId: created.id, created: true, status: created.status, onboarded: false };
}

export async function countActiveAdmins(): Promise<number> {
  return prisma.contact.count({
    where: { customerId: null, active: true, status: "ACTIVE", role: "ADMIN" },
  });
}

/** 승인 담당(활성 ADMIN) 목록 — 승인 대기 화면·지원 요청 안내용. */
export async function listAdmins() {
  return prisma.contact.findMany({
    where: { customerId: null, active: true, status: "ACTIVE", role: "ADMIN" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
}
