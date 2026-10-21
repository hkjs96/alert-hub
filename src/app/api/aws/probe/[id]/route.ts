import { NextResponse } from "next/server";
import { authMode, getCurrentUser } from "@/server/auth";
import { probeReader } from "@/server/graph";
import { errorSvg } from "@/lib/aws/error-svg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// 계정 매핑의 "연결 확인" — 관리자만. 성공하면 PNG, 실패하면 이유를 담은 SVG(이미지 칸에 그대로 보이게).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (authMode() !== "open") {
    const me = await getCurrentUser();
    if (!me || me.status !== "ACTIVE" || me.role !== "ADMIN" || me.customerId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }
  const r = await probeReader(params.id);
  if (r.ok) {
    return new NextResponse(Buffer.from(r.png), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  }
  return new NextResponse(errorSvg(r.error), { status: 200, headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store" } });
}
