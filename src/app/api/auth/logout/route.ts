import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { baseUrl } from "../_shared";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout — 쿠키 삭제. sameSite=lax 쿠키라 CSRF 걱정은 없다. */
export function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login?out=1", baseUrl(req)), { status: 303 });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
