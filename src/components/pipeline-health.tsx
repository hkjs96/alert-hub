import { unstable_noStore as noStore } from "next/cache";
import { prisma } from "@/lib/prisma";

/**
 * 헤더의 통지 파이프라인 헬스 (v2 헤더 우측). 아웃박스 상태에서 계산한다:
 * - 재시도 대기(pending) 잡이 있으면 지연 중,
 * - 최근 24시간 포기(failed) 잡이 있으면 유실 발생.
 * 헤더는 어떤 경우에도 죽으면 안 되므로 조회 실패는 표시 생략으로 삼킨다.
 */
export async function PipelineHealth() {
  noStore();
  try {
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const [retrying, gaveUp] = await Promise.all([
      prisma.notificationJob.count({ where: { status: "pending" } }),
      prisma.notificationJob.count({
        where: { status: "failed", updatedAt: { gte: dayAgo } },
      }),
    ]);

    const [color, label] =
      gaveUp > 0
        ? ["#b42318", `통지 포기 ${gaveUp}건 · 24h`]
        : retrying > 0
          ? ["#b54708", `통지 재시도 대기 ${retrying}건`]
          : ["#067647", "통지 파이프라인 정상"];

    return (
      <span className="hidden items-center gap-2 sm:flex">
        <span
          className="h-[7px] w-[7px] rounded-full"
          style={{ background: color }}
        />
        <span className="text-xs font-medium text-stone-900">{label}</span>
      </span>
    );
  } catch {
    return null;
  }
}
