import type { AlertStatus } from "@/lib/types";

const STATUS_STYLES: Record<string, string> = {
  FIRING: "bg-red-100 text-red-800 ring-red-600/20",
  RESOLVED: "bg-green-100 text-green-800 ring-green-600/20",
  ACKNOWLEDGED: "bg-blue-100 text-blue-800 ring-blue-600/20",
  INSUFFICIENT_DATA: "bg-gray-100 text-gray-700 ring-gray-500/20",
};

const SEVERITY_STYLES: Record<string, string> = {
  "SEV-0": "bg-red-600 text-white ring-red-700/30",
  "SEV-1": "bg-red-500 text-white ring-red-600/30",
  "SEV-2": "bg-orange-500 text-white ring-orange-600/30",
  "SEV-3": "bg-amber-400 text-amber-950 ring-amber-500/30",
  "SEV-4": "bg-yellow-300 text-yellow-900 ring-yellow-500/30",
  "SEV-5": "bg-slate-300 text-slate-800 ring-slate-400/30",
  // Word severities from Prometheus / Grafana / PagerDuty.
  CRITICAL: "bg-red-600 text-white ring-red-700/30",
  HIGH: "bg-orange-500 text-white ring-orange-600/30",
  ERROR: "bg-orange-500 text-white ring-orange-600/30",
  WARNING: "bg-amber-400 text-amber-950 ring-amber-500/30",
  LOW: "bg-yellow-300 text-yellow-900 ring-yellow-500/30",
  INFO: "bg-sky-200 text-sky-800 ring-sky-400/30",
  UNKNOWN: "bg-slate-200 text-slate-600 ring-slate-400/30",
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
  const label = (status as AlertStatus) === "INSUFFICIENT_DATA" ? "NO DATA" : status;
  return <Pill label={label} className={style} />;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const style = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.UNKNOWN;
  return <Pill label={severity} className={style} />;
}
