import { NextResponse, type NextRequest } from "next/server";
import { isEmailAllowed, readAuthConfig } from "@/lib/auth/config";
import { authorizeUrl } from "@/lib/auth/google";
import { randomToken } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/paths";
import { STATE_COOKIE, baseUrl, cookieOpts } from "../_shared";

export const dynamic = "force-dynamic";

/** GET /api/auth/login?next=/admin — Google로 보낸다. */
export function GET(req: NextRequest) {
  const cfg = readAuthConfig();
  if (!cfg.enabled) {
    return NextResponse.redirect(new URL("/login?error=disabled", baseUrl(req)));
  }
  const state = randomToken();
  const nonce = randomToken();
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const base = baseUrl(req);
  // "회사 이메일 → SSO로 계속": 허용 목록에 없는 이메일이면 Google 까지 가지
  // 않고 바로 접근 불가로. 맞으면 login_hint 로 계정 선택을 건너뛴다.
  const hint = req.nextUrl.searchParams.get("login_hint")?.trim().toLowerCase() || undefined;
  if (hint && !isEmailAllowed(hint, cfg.allowedDomains, cfg.allowedEmails)) {
    return NextResponse.redirect(new URL("/login?error=domain", base));
  }
  const hintDomain = hint?.split("@")[1];
  const res = NextResponse.redirect(
    authorizeUrl({
      clientId: cfg.clientId,
      redirectUri: `${base}/api/auth/callback`,
      state,
      nonce,
      hd: hintDomain && cfg.allowedDomains.includes(hintDomain)
        ? hintDomain
        : cfg.allowedDomains.length === 1 ? cfg.allowedDomains[0] : undefined,
      loginHint: hint,
    }),
  );
  res.cookies.set(STATE_COOKIE, JSON.stringify({ state, nonce, next }), {
    ...cookieOpts(base.startsWith("https://")),
    maxAge: 10 * 60,
  });
  return res;
}
