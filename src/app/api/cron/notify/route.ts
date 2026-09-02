import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { drainDueJobs } from "@/server/notify-queue";

export const dynamic = "force-dynamic";

// 아웃박스 드레인 틱 (신뢰성 트랙 ①). 인라인 1회 시도에 실패한 통지 잡을
// 지수 백오프 일정대로 재시도한다. escalate 틱과 마찬가지로 시간은 외부
// 스케줄러(QStash, Vercel Cron, crontab…)가 흘려보낸다 — 1분 간격 권장.
// GET /api/cron/notify?secret=… 또는 Authorization: Bearer …

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(req.url).searchParams.get("secret") ??
    "";
  if (!safeEqual(provided, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await drainDueJobs(new Date(), 50);
  return NextResponse.json(result);
}
