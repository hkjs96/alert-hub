import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { readAuthConfig } from "@/lib/auth/config";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "@/lib/auth/session";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  department: string | null;
  slackId: string | null;
  phone: string | null;
  /** 통지 프로필이 비어 있으면 헤더가 /me 로 유도한다. */
  profileIncomplete: boolean;
}

/** 쿠키만 본 세션(DB 조회 없음). 미들웨어와 같은 검증. */
export async function getSession(): Promise<SessionPayload | null> {
  const cfg = readAuthConfig();
  if (!cfg.enabled) return null;
  return verifySession(cookies().get(SESSION_COOKIE)?.value, cfg.secret);
}

/**
 * 세션 → DB의 내부 인원. 비활성 처리된 사람은 쿠키가 살아 있어도 null —
 * 서버 세션 테이블 없이도 "즉시 차단"이 되는 이유다.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const s = await getSession();
  if (!s) return null;
  const c = await prisma.contact.findUnique({ where: { id: s.sub } });
  if (!c || !c.active || c.customerId !== null) return null;
  return {
    id: c.id,
    name: c.name,
    email: c.email ?? s.email,
    department: c.department,
    slackId: c.slackId,
    phone: c.phone,
    profileIncomplete: !c.slackId && !c.phone,
  };
}

/** 액션에서 "누가"를 남길 때. 인증이 꺼져 있으면 null. */
export async function currentActorName(): Promise<string | null> {
  const u = await getCurrentUser();
  return u?.name ?? null;
}

export type JitResult =
  | { ok: true; contactId: string; created: boolean }
  | { ok: false; reason: "inactive" | "customer" };

/**
 * JIT 프로비저닝: 이메일로 내부 인원을 찾고, 없으면 만든다.
 * - 이메일이 고객사 담당자에 걸리면 거부("customer") — 고객사 사람은 로그인
 *   대상이 아니다. 같은 도메인을 쓰는 협력사 케이스는 관리자가 소속을 내부로
 *   바꾼 뒤 다시 로그인하면 된다.
 * - 비활성이면 거부("inactive").
 * - 이름이 비어 있던 기존 행은 Google 이름으로 채운다(사용자가 바꾼 이름은 유지).
 */
export async function provisionInternalContact(p: {
  email: string;
  name: string;
  now?: Date;
}): Promise<JitResult> {
  const now = p.now ?? new Date();
  const existing = await prisma.contact.findFirst({
    where: { email: { equals: p.email, mode: "insensitive" } },
    orderBy: [{ customerId: "asc" }, { createdAt: "asc" }], // 내부(null) 우선
  });
  if (existing) {
    if (existing.customerId !== null) return { ok: false, reason: "customer" };
    if (!existing.active) return { ok: false, reason: "inactive" };
    await prisma.contact.update({
      where: { id: existing.id },
      data: {
        lastLoginAt: now,
        ...(existing.name.trim() ? {} : { name: p.name }),
      },
    });
    return { ok: true, contactId: existing.id, created: false };
  }
  const created = await prisma.contact.create({
    data: { name: p.name, email: p.email, customerId: null, lastLoginAt: now },
  });
  return { ok: true, contactId: created.id, created: true };
}
