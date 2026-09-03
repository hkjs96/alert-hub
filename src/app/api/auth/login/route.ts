import { NextResponse, type NextRequest } from "next/server";
import { readAuthConfig } from "@/lib/auth/config";
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
  const res = NextResponse.redirect(
    authorizeUrl({
      clientId: cfg.clientId,
      redirectUri: `${base}/api/auth/callback`,
      state,
      nonce,
      hd: cfg.allowedDomains.length === 1 ? cfg.allowedDomains[0] : undefined,
    }),
  );
  res.cookies.set(STATE_COOKIE, JSON.stringify({ state, nonce, next }), {
    ...cookieOpts(base.startsWith("https://")),
    maxAge: 10 * 60,
  });
  return res;
}
