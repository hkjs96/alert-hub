import { waitUntil } from "@vercel/functions";
import { drainGraphs } from "@/server/graph";

/**
 * Slack 메시지가 나간 직후 그 알람들의 그래프를 붙인다. 응답(웹훅·크론)은 기다리지 않고
 * Vercel 이 함수를 조금 더 살려 두는 동안(waitUntil) 처리한다. 실패분은 크론이 재시도.
 */
export function afterSlackSent(alertIds: string[]): void {
  const work = drainGraphs(alertIds.length, Array.from(new Set(alertIds))).catch((err) => {
    console.error("[graph] post-send attach failed", err);
  });
  try {
    waitUntil(work);
  } catch {
    // Vercel 밖(로컬·테스트): 프로세스가 살아 있으니 그냥 진행
  }
}
