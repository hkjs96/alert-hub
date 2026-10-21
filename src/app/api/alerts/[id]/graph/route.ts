import { NextResponse } from "next/server";
import { assertAlertInScope } from "@/server/scope";
import { alertGraphPng } from "@/server/graph";
import { errorSvg } from "@/lib/aws/error-svg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// 알람 상세의 그래프 — 그 알람을 볼 수 있는 사람만(스코프 검사). 읽기 역할이 없으면 404.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await assertAlertInScope(params.id);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const png = await alertGraphPng(params.id);
    return new NextResponse(Buffer.from(png), { headers: { "content-type": "image/png", "cache-control": "private, max-age=60" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new NextResponse(errorSvg(msg, "그래프를 불러오지 못했습니다"), {
      headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
