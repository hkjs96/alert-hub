import { NextResponse } from "next/server";
import { authMode, getCurrentUser } from "@/server/auth";
import { probeReader } from "@/server/graph";

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

function errorSvg(message: string): string {
  const esc = message.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
  const lines = esc.match(/.{1,60}/g) ?? [esc];
  const tspans = lines.map((l, i) => `<tspan x="16" dy="${i ? 18 : 0}">${l}</tspan>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${60 + lines.length * 18}"><rect width="100%" height="100%" fill="#fdf6ec"/><text x="16" y="28" font-family="sans-serif" font-size="13" font-weight="700" fill="#b54708">연결 실패</text><text x="16" y="50" font-family="sans-serif" font-size="12" fill="#4a4842">${tspans}</text></svg>`;
}
