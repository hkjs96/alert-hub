import Link from "next/link";
import { notFound } from "next/navigation";
import { getAlert } from "@/server/alerts";
import { SeverityBadge, StatusBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

function formatTime(date: Date) {
  return new Date(date).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-800">{value}</dd>
    </div>
  );
}

export default async function AlertDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const alert = await getAlert(params.id);
  if (!alert) notFound();

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Back to alerts
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{alert.title}</h1>
        <SeverityBadge severity={alert.severity} />
        <StatusBadge status={alert.status} />
      </div>

      {alert.description ? (
        <p className="text-slate-600">{alert.description}</p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Details
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Field label="Source" value={alert.source} />
          <Field label="Resource" value={alert.resource} />
          <Field label="Metric" value={alert.metric} />
          <Field label="Namespace" value={alert.namespace} />
          <Field label="Value" value={alert.value} />
          <Field
            label="Threshold"
            value={alert.threshold !== null ? String(alert.threshold) : null}
          />
          <Field label="Comparison" value={alert.comparison} />
          <Field label="Region" value={alert.region} />
          <Field label="Account" value={alert.accountId} />
          <Field label="Count" value={String(alert.count)} />
          <Field label="First seen" value={formatTime(alert.firstSeenAt)} />
          <Field label="Last seen" value={formatTime(alert.lastSeenAt)} />
        </dl>
        {alert.stateReason ? (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <dt className="text-xs uppercase tracking-wide text-slate-400">
              State reason
            </dt>
            <dd className="mt-0.5 text-sm text-slate-700">{alert.stateReason}</dd>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Event timeline
        </h2>
        <ol className="relative space-y-4 border-l border-slate-200 pl-6">
          {alert.events.map((ev) => (
            <li key={ev.id} className="relative">
              <span className="absolute -left-[27px] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-400 ring-4 ring-white" />
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={ev.status} />
                <time className="text-xs text-slate-400">
                  {formatTime(ev.createdAt)}
                </time>
              </div>
              {ev.stateReason ? (
                <p className="mt-1 text-sm text-slate-600">{ev.stateReason}</p>
              ) : null}
              {ev.value ? (
                <p className="mt-0.5 text-xs text-slate-400">value: {ev.value}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
