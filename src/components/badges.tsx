// v2(웜 페이퍼 콘솔): 배지는 칩이 아니라 "도형 마크 + 모노 레터스페이스
// 라벨"이다. 상태마다 색과 도형이 다 달라서(●/▲/○/✓/–) 색약 환경에서도
// 도형만으로 구분된다 — alert-hub v2.dc.html의 ST/SEV 규약 그대로.
type MarkShape = "dot" | "tri" | "ring" | "check" | "dash";

interface Tone {
  color: string;
  shape: MarkShape;
}

export const STATUS_TONES: Record<string, Tone> = {
  FIRING: { color: "#b42318", shape: "dot" },
  // AlertEvent-only marker written by the escalation cron; never an Alert.status.
  ESCALATED: { color: "#b54708", shape: "tri" },
  ACKNOWLEDGED: { color: "#4a5568", shape: "ring" },
  RESOLVED: { color: "#067647", shape: "check" },
  INSUFFICIENT_DATA: { color: "#8a877f", shape: "dash" },
};

export const STATUS_LABELS: Record<string, string> = {
  FIRING: "FIRING",
  RESOLVED: "RESOLVED",
  ACKNOWLEDGED: "ACK",
  ESCALATED: "ESCALATED",
  INSUFFICIENT_DATA: "NO DATA",
};

export const SEVERITY_TONES: Record<string, Tone> = {
  "SEV-0": { color: "#7a1710", shape: "dot" },
  "SEV-1": { color: "#b42318", shape: "dot" },
  "SEV-2": { color: "#b54708", shape: "tri" },
  "SEV-3": { color: "#8a877f", shape: "ring" },
  "SEV-4": { color: "#8a877f", shape: "ring" },
  "SEV-5": { color: "#8a877f", shape: "dash" },
  CRITICAL: { color: "#b42318", shape: "dot" },
  HIGH: { color: "#b54708", shape: "tri" },
  ERROR: { color: "#b54708", shape: "tri" },
  WARNING: { color: "#8a877f", shape: "ring" },
  LOW: { color: "#8a877f", shape: "ring" },
  INFO: { color: "#8a877f", shape: "dash" },
  UNKNOWN: { color: "#8a877f", shape: "dash" },
};

export function statusTone(status: string): Tone {
  return STATUS_TONES[status] ?? STATUS_TONES.INSUFFICIENT_DATA;
}

export function severityTone(severity: string): Tone {
  return SEVERITY_TONES[severity] ?? SEVERITY_TONES.UNKNOWN;
}

/** 도형 마크 — dot(●)/ring(○)/tri(▲)/check(✓)/dash(–), 색은 인라인. */
export function Mark({ color, shape }: Tone) {
  switch (shape) {
    case "dot":
      return (
        <span
          className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
          style={{ background: color }}
        />
      );
    case "ring":
      return (
        <span
          className="inline-block h-[7px] w-[7px] shrink-0 rounded-full border-[1.5px]"
          style={{ borderColor: color }}
        />
      );
    case "tri":
      return (
        <span
          className="inline-block h-0 w-0 shrink-0"
          style={{
            borderLeft: "4px solid transparent",
            borderRight: "4px solid transparent",
            borderBottom: `7px solid ${color}`,
          }}
        />
      );
    case "check":
      return (
        <span
          className="mb-[2px] inline-block h-[4px] w-[7px] shrink-0 -rotate-45"
          style={{
            borderLeft: `1.5px solid ${color}`,
            borderBottom: `1.5px solid ${color}`,
          }}
        />
      );
    default:
      return (
        <span
          className="inline-block h-[1.5px] w-2 shrink-0"
          style={{ background: color }}
        />
      );
  }
}

function ToneLabel({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] font-bold tracking-[0.06em]"
      style={{ color: tone.color }}
    >
      <Mark {...tone} />
      {label}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <ToneLabel tone={statusTone(status)} label={STATUS_LABELS[status] ?? status} />
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  return <ToneLabel tone={severityTone(severity)} label={severity} />;
}
