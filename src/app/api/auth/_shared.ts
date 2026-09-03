import type { NextRequest } from "next/server";

export const STATE_COOKIE = "ah_oauth";

/** 콜백 URL의 origin: APP_URL이 있으면 그것, 없으면 요청 origin. */
export function baseUrl(req: NextRequest): string {
  const configured = process.env.APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

export function cookieOpts(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/" };
}
