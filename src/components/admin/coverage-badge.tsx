import { Mark } from "@/components/badges";

/**
 * 담당 커버리지 배지 (O2): 이 스코프의 알람이 실제로 누구에게 가는가.
 * 직접 등록 / 상위 상속 / 미지정(⚠ — 알람이 아무에게도 배정되지 않음).
 */
export function CoverageBadge({
  direct,
  inheritedFrom,
}: {
  /** 이 스코프에 직접 등록된 인원 수. */
  direct: number;
  /** 직접 등록이 없을 때 실제로 적용되는 상위 레벨 이름 (없으면 미지정). */
  inheritedFrom?: "프로젝트" | "고객사" | null;
}) {
  if (direct > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-[0.08em] text-stone-900">
        <Mark color="#1b1a17" shape="dot" />
        직접 {direct}명
      </span>
    );
  }
  if (inheritedFrom) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] text-stone-400">
        <Mark color="#c9c4b8" shape="ring" />
        {inheritedFrom} 상속
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-[0.08em] text-[#b42318]"
      title="이 스코프의 알람은 담당자 없이 수신됩니다"
    >
      <Mark color="#b42318" shape="tri" />⚠ 미지정
    </span>
  );
}
