import Link from "next/link";
import { notFound } from "next/navigation";
import { getAlert } from "@/server/alerts";
import { ackAlert, resolveAlert } from "@/server/alert-actions";
import {
  getOwnershipByAwsAccount,
  parseOwnershipSnapshot,
  type OwnershipInfo,
  type OwnershipSnapshot,
} from "@/server/org";
import { levelLabel } from "@/lib/org/resolve";
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

/**
 * Ack / Resolve (Phase 2c). Buttons are disabled — not hidden — outside their
 * legal source states, so the state machine stays visible: ack only takes a
 * FIRING alert, resolve takes FIRING or ACKNOWLEDGED, RESOLVED is terminal
 * until the alarm re-fires. The actions are guarded server-side too, so a
 * stale tab clicking an enabled button is still a no-op.
 */
function AlertActions({ id, status }: { id: string; status: string }) {
  const canAck = status === "FIRING";
  const canResolve = status === "FIRING" || status === "ACKNOWLEDGED";
  return (
    <span className="ml-auto flex items-center gap-2">
      <form action={ackAlert}>
        <input type="hidden" name="id" value={id} />
        <button
          disabled={!canAck}
          title={canAck ? undefined : "FIRING 상태에서만 Ack할 수 있습니다"}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
        >
          Acknowledge
        </button>
      </form>
      <form action={resolveAlert}>
        <input type="hidden" name="id" value={id} />
        <button
          disabled={!canResolve}
          title={
            canResolve ? undefined : "이미 종료되었거나 전이할 수 없는 상태입니다"
          }
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        >
          Resolve
        </button>
      </form>
    </span>
  );
}

/**
 * 담당 · 조직 패널 — the people side of the alert.
 *
 * A fire-time snapshot, when present, is the authority: it shows who was
 * actually notified, and reordering the team later must not rewrite it. The
 * live resolution is rendered as a secondary "현재 등록" hint only when it
 * differs. Rows without a snapshot (legacy, or received while unassigned)
 * fall back to the live resolution.
 */
function SnapshotPanel({
  snapshot,
  current,
}: {
  snapshot: OwnershipSnapshot;
  current: OwnershipInfo | null;
}) {
  const { chain } = snapshot;
  const escalationHref = `/admin/escalation?customerId=${chain.customerId}&projectId=${chain.projectId}&serviceId=${chain.serviceId}&level=${snapshot.level === "account" ? "service" : (snapshot.level ?? "service")}`;

  const currentIds = current ? current.contacts.map((c) => c.id).join(",") : null;
  const snapIds = snapshot.order.map((o) => o.contactId).join(",");
  const driftsFromCurrent =
    !current ||
    current.responsibility.level !== snapshot.level ||
    currentIds !== snapIds;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
        담당 · 조직 <span className="font-normal normal-case">(수신 시점 스냅샷)</span>
      </h2>

      <div className="flex flex-wrap items-center gap-1 text-sm text-slate-600">
        <Link
          href={`/admin/customers/${chain.customerId}`}
          className="font-medium text-slate-800 hover:text-blue-600 hover:underline"
        >
          {chain.customerName}
        </Link>
        <span className="text-slate-300">/</span>
        <Link
          href={`/admin/projects/${chain.projectId}`}
          className="hover:text-blue-600 hover:underline"
        >
          {chain.projectName}
        </Link>
        <span className="text-slate-300">/</span>
        <Link
          href={`/admin/services/${chain.serviceId}`}
          className="hover:text-blue-600 hover:underline"
        >
          {chain.serviceName}
        </Link>
        {chain.accountAlias ? (
          <>
            <span className="text-slate-300">/</span>
            <span className="font-mono text-xs">{chain.accountAlias}</span>
          </>
        ) : null}
        {chain.environment ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
            {chain.environment}
          </span>
        ) : null}
      </div>

      <p className="mb-2 mt-4 text-xs text-slate-400">
        {levelLabel(snapshot.level)} 단계의 순서 · 알람이 접수/재발화됐을 때 통지된
        기준입니다 ({formatTime(new Date(snapshot.capturedAt))})
      </p>
      <ol className="space-y-1.5">
        {snapshot.order.map((o, i) => (
          <li key={o.contactId} className="flex items-center gap-2 text-sm">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-semibold tabular-nums ${
                i === 0 ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"
              }`}
            >
              {i + 1}
            </span>
            <span className={i === 0 ? "font-medium text-slate-900" : "text-slate-700"}>
              {o.name}
            </span>
            {o.department ? (
              <span className="text-xs text-slate-400">{o.department}</span>
            ) : null}
            {i === 0 ? (
              <span className="text-xs font-medium text-blue-600">1순위</span>
            ) : null}
          </li>
        ))}
      </ol>

      {driftsFromCurrent ? (
        <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
          {current ? (
            <>
              현재 등록 기준과 다릅니다 — 지금은{" "}
              {current.contacts.length > 0 ? (
                <span className="text-slate-700">
                  {current.contacts.map((c) => c.name).join(" → ")} (
                  {levelLabel(current.responsibility.level)} 단계)
                </span>
              ) : (
                <span className="text-slate-700">담당자 미등록</span>
              )}{" "}
              ·{" "}
              <Link href={escalationHref} className="underline hover:text-blue-600">
                순서 편집
              </Link>
            </>
          ) : (
            <>현재 이 계정은 어느 서비스에도 매핑되어 있지 않습니다.</>
          )}
        </p>
      ) : null}
    </section>
  );
}

function OwnershipPanel({
  accountId,
  info,
}: {
  accountId: string;
  info: OwnershipInfo | null;
}) {
  if (!info) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-700">
          담당 · 조직
        </h2>
        <p className="text-sm text-amber-800">
          계정{" "}
          <code className="rounded bg-white px-1 py-0.5 font-mono text-xs">
            {accountId}
          </code>
          이(가) 어느 서비스에도 매핑되어 있지 않아 담당을 결정할 수 없습니다.{" "}
          <Link href="/admin/customers" className="font-medium underline">
            조직 · 담당자 관리
          </Link>
          의 서비스 페이지에서 이 계정을 매핑하면 담당이 잡힙니다.
        </p>
      </section>
    );
  }

  const { chain, responsibility, contacts } = info;
  const escalationHref = `/admin/escalation?customerId=${chain.customer.id}&projectId=${chain.project.id}&serviceId=${chain.service.id}&level=${responsibility.level === "account" ? "service" : (responsibility.level ?? "service")}`;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
        담당 · 조직
      </h2>

      <div className="flex flex-wrap items-center gap-1 text-sm text-slate-600">
        <Link
          href={`/admin/customers/${chain.customer.id}`}
          className="font-medium text-slate-800 hover:text-blue-600 hover:underline"
        >
          {chain.customer.name}
        </Link>
        <span className="text-slate-300">/</span>
        <Link
          href={`/admin/projects/${chain.project.id}`}
          className="hover:text-blue-600 hover:underline"
        >
          {chain.project.name}
        </Link>
        <span className="text-slate-300">/</span>
        <Link
          href={`/admin/services/${chain.service.id}`}
          className="hover:text-blue-600 hover:underline"
        >
          {chain.service.name}
        </Link>
        <span className="text-slate-300">/</span>
        <span className="font-mono text-xs">
          {chain.account.alias ?? chain.account.accountId}
        </span>
        {chain.account.environment ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
            {chain.account.environment}
          </span>
        ) : null}
      </div>

      {contacts.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">
          체인 어느 단계에도 담당자가 등록되어 있지 않습니다 —{" "}
          <Link href={escalationHref} className="underline hover:text-blue-600">
            알람 처리 순서
          </Link>
          에서 등록하세요.
        </p>
      ) : (
        <>
          <p className="mb-2 mt-4 text-xs text-slate-400">
            {levelLabel(responsibility.level)} 단계의 순서가 적용됩니다 (현재 등록
            기준) ·{" "}
            <Link href={escalationHref} className="underline hover:text-blue-600">
              순서 편집
            </Link>
          </p>
          <ol className="space-y-1.5">
            {contacts.map((c, i) => (
              <li key={c.id} className="flex items-center gap-2 text-sm">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-semibold tabular-nums ${
                    i === 0 ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {i + 1}
                </span>
                <span className={i === 0 ? "font-medium text-slate-900" : "text-slate-700"}>
                  {c.name}
                </span>
                {c.department ? (
                  <span className="text-xs text-slate-400">{c.department}</span>
                ) : null}
                {i === 0 ? (
                  <span className="text-xs font-medium text-blue-600">1순위</span>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

export default async function AlertDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const alert = await getAlert(params.id);
  if (!alert) notFound();

  const ownership = alert.accountId
    ? await getOwnershipByAwsAccount(alert.accountId)
    : null;
  const snapshot = parseOwnershipSnapshot(alert.ownershipSnapshot);

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Back to alerts
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{alert.title}</h1>
        <SeverityBadge severity={alert.severity} />
        <StatusBadge status={alert.status} />
        <AlertActions id={alert.id} status={alert.status} />
      </div>

      {alert.description ? (
        <p className="text-slate-600">{alert.description}</p>
      ) : null}

      {snapshot && snapshot.order.length > 0 ? (
        <SnapshotPanel snapshot={snapshot} current={ownership} />
      ) : alert.accountId ? (
        <OwnershipPanel accountId={alert.accountId} info={ownership} />
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
