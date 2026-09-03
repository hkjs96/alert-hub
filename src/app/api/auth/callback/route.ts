import { NextResponse, type NextRequest } from "next/server";
import { isEmailAllowed, readAuthConfig } from "@/lib/auth/config";
import { decodeIdToken, exchangeCode, validateClaims } from "@/lib/auth/google";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/paths";
import { provisionInternalContact } from "@/server/auth";
import { newRef } from "@/lib/auth/ref";
import { STATE_COOKIE, baseUrl, cookieOpts } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/callback?code&state — 코드 교환 → 클레임 검증 → 도메인 확인
 * → JIT 프로비저닝 → 세션 쿠키. 실패는 전부 /login?error=… 로 돌려보내고
 * 이유는 로그에만 자세히 남긴다(화면에는 종류만).
 */
export async function GET(req: NextRequest) {
  const cfg = readAuthConfig();
  const base = baseUrl(req);
  // 실패는 참조 코드와 함께 로그에만 자세히 남기고, 화면에는 종류와 코드만.
  const fail = (error: string, detail?: string) => {
    const ref = newRef("AU");
    console.warn(`[auth] ${ref} login failed: ${error}${detail ? ` — ${detail}` : ""}`);
    const res = NextResponse.redirect(new URL(`/login?error=${error}&ref=${ref}`, base));
    res.cookies.delete(STATE_COOKIE);
    return res;
  };
  if (!cfg.enabled) return fail("disabled");

  const raw = req.cookies.get(STATE_COOKIE)?.value;
  let saved: { state?: string; nonce?: string; next?: string } = {};
  try {
    saved = raw ? JSON.parse(raw) : {};
  } catch {
    saved = {};
  }
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return fail("denied", q.get("error") ?? undefined);
  const code = q.get("code");
  if (!code || !saved.state || q.get("state") !== saved.state || !saved.nonce) {
    return fail("state", "state/nonce cookie mismatch");
  }

  const token = await exchangeCode({
    code,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    redirectUri: `${base}/api/auth/callback`,
  });
  if (!token.id_token) return fail("exchange", token.error_description ?? token.error);

  const claims = validateClaims(decodeIdToken(token.id_token), {
    clientId: cfg.clientId,
    nonce: saved.nonce,
  });
  if (!claims.ok) return fail("claims", claims.reason);
  if (!isEmailAllowed(claims.email, cfg.allowedDomains, cfg.allowedEmails)) {
    return fail("domain", claims.email);
  }

  const jit = await provisionInternalContact({ email: claims.email, name: claims.name });
  if (!jit.ok) return fail(jit.reason, claims.email);

  const session = await signSession(
    { sub: jit.contactId, email: claims.email, name: claims.name },
    cfg.secret,
  );
  // 승인 대기면 /pending, 첫 로그인 프로필을 아직 안 마쳤으면 /welcome, 아니면
  // 원래 가려던 곳.
  const dest =
    jit.status === "PENDING" ? "/pending" : !jit.onboarded ? "/welcome" : safeNext(saved.next);
  const res = NextResponse.redirect(new URL(dest, base));
  res.cookies.delete(STATE_COOKIE);
  res.cookies.set(SESSION_COOKIE, session, {
    ...cookieOpts(base.startsWith("https://")),
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
