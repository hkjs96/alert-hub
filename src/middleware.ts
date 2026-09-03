import { NextResponse, type NextRequest } from "next/server";
import { readAuthConfig } from "@/lib/auth/config";
import { isPublicPath } from "@/lib/auth/paths";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

/**
 * SSO가 켜져 있을 때만 화면·서버 액션을 세션 뒤로 둔다. 웹훅·크론·인증 경로는
 * 통과(isPublicPath). 여기서는 쿠키 서명만 보고, 비활성 여부는 페이지의
 * getCurrentUser가 DB로 확인한다 — Edge에서 Prisma를 부르지 않기 위해서.
 */
export async function middleware(req: NextRequest) {
  const cfg = readAuthConfig();
  if (!cfg.enabled) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, cfg.secret);
  if (session) return NextResponse.next();

  // 서버 액션(POST)이나 API는 리다이렉트 대신 401 — 폼이 조용히 로그인 화면
  // HTML을 받아 버리는 것보다 낫다.
  if (req.method !== "GET" || pathname.startsWith("/api/")) {
    return new NextResponse("로그인이 필요합니다", { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  const res = NextResponse.redirect(url);
  if (req.cookies.get(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/).*)"],
};
