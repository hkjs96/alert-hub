import { NextResponse } from "next/server";
import { verifyGraphSig } from "@/lib/aws/graph-url";
import { alertGraphPng } from "@/server/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Slack 본문 그래프 — Slack 이 이 주소에서 그림을 가져간다(로그인 없음). 서명(알람 id + 만료)이
// 맞을 때만, 그 알람 하나의 그래프만. 발화 시각 기준 고정 창이라 다시 불러와도 같은 그림.
export async function GET(req: Request, { params }: { params: { file: string } }) {
  const alertId = decodeURIComponent(params.file).replace(/\.png$/, "");
  const url = new URL(req.url);
  const check = verifyGraphSig(alertId, url.searchParams.get("e"), url.searchParams.get("s"));
  if (!check.ok) return new NextResponse(null, { status: check.reason === "expired" ? 410 : 403 });
  try {
    const png = await alertGraphPng(alertId, { aroundFiring: true });
    return new NextResponse(Buffer.from(png), {
      headers: { "content-type": "image/png", "cache-control": "public, max-age=86400, immutable" },
    });
  } catch (err) {
    console.error("[graph] signed image failed", alertId, err);
    return new NextResponse(null, { status: 404 });
  }
}
