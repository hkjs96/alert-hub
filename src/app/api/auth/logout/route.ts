import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { baseUrl } from "../_shared";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout — 쿠키 삭제. sameSite=lax 쿠키라 CSRF 걱정은 없다. */
export async function POST(req: NextRequest) {
  let dest = "/login?out=1";
  try {
    const fd = await req.formData();
    const n = fd.get("next");
    if (typeof n === "string" && n === "/login") dest = "/login";
  } catch {
    /* 본문 없음 */
  }
  const res = NextResponse.redirect(new URL(dest, baseUrl(req)), { status: 303 });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
