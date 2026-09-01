// B안(라이트 정밀): 진한 채움 대신 옅은 바탕 + 같은 계열 보더 — 배지가
// 소리치지 않고도 구분된다. 라벨은 문장 케이스.
const STATUS_STYLES: Record<string, string> = {
  FIRING: "bg-red-50 text-red-700 ring-red-200",
  RESOLVED: "bg-green-50 text-green-700 ring-green-200",
  ACKNOWLEDGED: "bg-blue-50 text-blue-700 ring-blue-200",
  // AlertEvent-only marker written by the escalation cron; never an Alert.status.
  ESCALATED: "bg-orange-50 text-orange-700 ring-orange-200",
  INSUFFICIENT_DATA: "bg-stone-100 text-stone-600 ring-stone-300",
};

const STATUS_LABELS: Record<string, string> = {
  FIRING: "Firing",
  RESOLVED: "Resolved",
  ACKNOWLEDGED: "Ack",
  ESCALATED: "Escalated",
  INSUFFICIENT_DATA: "No Data",
};

const SEVERITY_STYLES: Record<string, string> = {
  "SEV-0": "bg-red-600 text-white ring-red-700/30",
  "SEV-1": "bg-red-500 text-white ring-red-600/30",
  "SEV-2": "bg-orange-500 text-white ring-orange-600/30",
  "SEV-3": "bg-amber-400 text-amber-950 ring-amber-500/30",
  "SEV-4": "bg-yellow-300 text-yellow-900 ring-yellow-500/30",
  "SEV-5": "bg-stone-300 text-stone-800 ring-stone-400/30",
  // Word severities from Prometheus / Grafana / PagerDuty.
  CRITICAL: "bg-red-600 text-white ring-red-700/30",
  HIGH: "bg-orange-500 text-white ring-orange-600/30",
  ERROR: "bg-orange-500 text-white ring-orange-600/30",
  WARNING: "bg-amber-400 text-amber-950 ring-amber-500/30",
  LOW: "bg-yellow-300 text-yellow-900 ring-yellow-500/30",
  INFO: "bg-sky-200 text-sky-800 ring-sky-400/30",
  UNKNOWN: "bg-stone-200 text-stone-600 ring-stone-400/30",
};

function Pill({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      {label}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.INSUFFICIENT_DATA;
  const label = STATUS_LABELS[status] ?? status;
  return <Pill label={label} className={style} />;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const style = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.UNKNOWN;
  return <Pill label={severity} className={style} />;
}
