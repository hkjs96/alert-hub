import Link from "next/link";
import { notFound } from "next/navigation";
import { getAlert } from "@/server/alerts";
import { ackAlert, resolveAlert } from "@/server/alert-actions";
import { muteAlert, revokeSilence } from "@/server/silence-actions";
import { findActiveSilence } from "@/server/silences";
import { muteUntilLabel, type SilenceRow } from "@/lib/silence";
import {
  getOwnershipByAwsAccount,
  parseOwnershipSnapshot,
  type OwnershipInfo,
  type OwnershipSnapshot,
} from "@/server/org";
import { levelLabel } from "@/lib/org/resolve";
import {
  Mark,
  STATUS_LABELS,
  SeverityBadge,
  StatusBadge,
  severityTone,
  statusTone,
} from "@/components/badges";
import { PendingButton } from "@/components/pending-button";

export const dynamic = "force-dynamic";

function formatTime(date: Date) {
  return new Date(date).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex flex-col">
      <dt className="font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">
        {label}
      </dt>
      <dd
        className={`mt-1.5 break-words text-[13px] text-stone-900 ${
          mono ? "font-mono" : "font-medium"
        }`}
      >
        {value}
      </dd>
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
    <span className="flex flex-none items-center gap-2">
      <form action={ackAlert}>
        <input type="hidden" name="id" value={id} />
        <PendingButton
          pendingLabel="Ack 중…"
          disabled={!canAck}
          title={canAck ? undefined : "FIRING 상태에서만 Ack할 수 있습니다"}
          className="inline-flex h-8 items-center gap-[7px] border border-indigo-600 bg-indigo-600 px-4 text-[13px] font-semibold text-white transition-colors hover:border-indigo-700 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:border-stone-100 disabled:bg-stone-100 disabled:text-stone-400"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3.2 8.4 6.4 11.6 12.8 4.8" />
          </svg>
          Acknowledge
        </PendingButton>
      </form>
      <form action={resolveAlert}>
        <input type="hidden" name="id" value={id} />
        <PendingButton
          pendingLabel="Resolve 중…"
          disabled={!canResolve}
          title={
            canResolve ? undefined : "이미 종료되었거나 전이할 수 없는 상태입니다"
          }
          className="inline-flex h-8 items-center border border-stone-200 bg-white px-3.5 text-[13px] font-medium text-stone-900 transition-colors hover:border-stone-400 disabled:cursor-not-allowed disabled:border-stone-100 disabled:bg-stone-100 disabled:text-stone-400"
        >
          Resolve
        </PendingButton>
      </form>
    </span>
  );
}

/**
 * 뮤트 팝오버 (v2 프레임 03) — JS 없이 <details>로 연다. 기간·범위·사유를
 * 받아 muteAlert 액션으로 Silence 행을 만든다. 사유는 필수.
 */
function MuteControl({
  alertId,
  serviceId,
  serviceLabel,
  backHref,
}: {
  alertId: string;
  serviceId: string | null;
  serviceLabel: string | null;
  backHref: string;
}) {
  const overline =
    "font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400";
  return (
    <details className="relative">
      <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-[7px] border border-stone-200 bg-white px-3.5 text-[13px] font-medium text-stone-900 transition-colors hover:border-stone-400 [&::-webkit-details-marker]:hidden">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="#6b6862"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M8.5 3 5 6H2.5v4H5l3.5 3z" />
          <path d="M11.5 5.5 14 10.5M14 5.5l-2.5 5" />
        </svg>
        뮤트
      </summary>
      <form
        action={muteAlert}
        className="absolute right-0 top-10 z-10 w-[380px] space-y-4 border border-stone-300 bg-white p-[18px] text-left shadow-[0_18px_44px_rgba(27,26,23,0.18)]"
      >
        <input type="hidden" name="alertId" value={alertId} />
        <input type="hidden" name="back" value={backHref} />
        {serviceId ? <input type="hidden" name="serviceId" value={serviceId} /> : null}
        <div className="text-sm font-semibold text-stone-900">알람 뮤트</div>
        <div>
          <div className={`mb-2 ${overline}`}>기간 (UTC)</div>
          <div className="flex flex-col gap-1.5 text-[13px]">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="preset" value="1h" defaultChecked required />
              1시간
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="preset" value="tomorrow9" required />
              내일 09:00Z
            </label>
            <label className="flex flex-wrap items-center gap-1.5">
              <input type="radio" name="preset" value="custom" required />
              기간 지정
              <input
                type="datetime-local"
                name="endsAt"
                aria-label="종료 (UTC)"
                className="h-8 rounded-md border border-stone-300 bg-white px-2.5 text-xs shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400"
              />
            </label>
          </div>
        </div>
        <div>
          <div className={`mb-2 ${overline}`}>범위</div>
          <div className="flex flex-col gap-1.5 text-[13px]">
            <label className="flex items-start gap-1.5">
              <input type="radio" name="scope" value="alert" defaultChecked required className="mt-0.5" />
              <span>
                <span className="font-medium text-stone-900">이 알람만</span>
                <span className="block text-xs text-stone-500">
                  동일 리소스·메트릭 조합 (재발화 포함)
                </span>
              </span>
            </label>
            {serviceId ? (
              <label className="flex items-start gap-1.5">
                <input type="radio" name="scope" value="service" required className="mt-0.5" />
                <span>
                  <span className="font-medium text-stone-900">서비스 전체</span>
                  <span className="block text-xs text-stone-500">{serviceLabel}</span>
                </span>
              </label>
            ) : null}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className={overline}>사유</span>
            <span className="font-mono text-[10px] font-bold tracking-[0.08em] text-[#b42318]">
              필수
            </span>
          </div>
          <input
            name="reason"
            required
            placeholder="예) RDS 스케일업 작업 중 (CHG-2418)"
            className="h-8 w-full rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400"
          />
        </div>
        <p className="border border-stone-100 bg-stone-50 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
          수집과 상태 전이는 계속됩니다. 통지와 에스컬레이션만 멈추며, 알람은
          목록에 그대로 남고 뮤트 칩이 함께 표시됩니다.
        </p>
        <div className="flex justify-end">
          <PendingButton pendingLabel="적용 중…" className="inline-flex h-8 items-center border border-stone-900 bg-stone-900 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-stone-700">
            뮤트 적용
          </PendingButton>
        </div>
      </form>
    </details>
  );
}

/** 진행 중인 뮤트/점검 창 배너 — 왜 조용한지 화면에서 설명한다. */
function MutedBanner({
  silence,
  alertId,
  backHref,
}: {
  silence: SilenceRow;
  alertId: string;
  backHref: string;
}) {
  const isAlertScope = silence.alertId === alertId;
  return (
    <div className="flex flex-wrap items-center gap-3 border border-stone-200 border-l-[3px] border-l-[#8a877f] bg-white px-4 py-3">
      <span className="font-mono text-[10px] font-bold tracking-[0.1em] text-stone-500">
        뮤트 중
      </span>
      <span className="text-[13px] font-semibold text-stone-900">
        {isAlertScope ? "이 알람" : "점검 창(상위 스코프)"} ·{" "}
        <span className="font-mono text-xs">{muteUntilLabel(silence.endsAt)}</span>
      </span>
      <span className="text-[13px] text-stone-500">
        사유: {silence.reason} — 통지·에스컬레이션만 멈추고 수집은 계속됩니다.
      </span>
      {isAlertScope ? (
        <form action={revokeSilence} className="ml-auto">
          <input type="hidden" name="id" value={silence.id} />
          <input type="hidden" name="back" value={backHref} />
          <PendingButton pendingLabel="해제 중…" className="inline-flex h-[26px] items-center border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-900 transition-colors hover:border-stone-400">
            지금 해제
          </PendingButton>
        </form>
      ) : (
        <Link
          href="/admin/silences"
          className="ml-auto text-[13px] font-semibold text-indigo-600 hover:underline"
        >
          점검 · 뮤트 관리 →
        </Link>
      )}
    </div>
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
    <section className="border border-stone-200 bg-white">
      <div className="border-b border-stone-200 px-6 py-3">
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">
          담당 · 수신 시점 스냅샷
        </h2>
      </div>
      <div className="p-6 pt-4">
      <div className="flex flex-wrap items-center gap-1.5 text-sm text-stone-600">
        <Link
          href={`/admin/customers/${chain.customerId}`}
          className="font-medium text-stone-800 hover:text-indigo-600 hover:underline"
        >
          {chain.customerName}
        </Link>
        <span className="font-mono text-xs text-stone-300">›</span>
        <Link
          href={`/admin/projects/${chain.projectId}`}
          className="hover:text-indigo-600 hover:underline"
        >
          {chain.projectName}
        </Link>
        <span className="font-mono text-xs text-stone-300">›</span>
        <Link
          href={`/admin/services/${chain.serviceId}`}
          className="hover:text-indigo-600 hover:underline"
        >
          {chain.serviceName}
        </Link>
        {chain.accountAlias ? (
          <>
            <span className="font-mono text-xs text-stone-300">›</span>
            <span className="font-mono text-xs">{chain.accountAlias}</span>
          </>
        ) : null}
        {chain.environment ? (
          <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-stone-500">
            {chain.environment}
          </span>
        ) : null}
      </div>

      <p className="mb-2 mt-4 text-xs text-stone-400">
        {levelLabel(snapshot.level)} 단계의 순서 · 알람이 접수/재발화됐을 때 통지된
        기준입니다 ({formatTime(new Date(snapshot.capturedAt))})
      </p>
      <ol className="space-y-1.5">
        {snapshot.order.map((o, i) => (
          <li key={o.contactId} className="flex items-center gap-2 text-sm">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-semibold tabular-nums ${
                i === 0 ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-500"
              }`}
            >
              {i + 1}
            </span>
            <span className={i === 0 ? "font-medium text-stone-900" : "text-stone-700"}>
              {o.name}
            </span>
            {o.department ? (
              <span className="text-xs text-stone-400">{o.department}</span>
            ) : null}
            {i === 0 ? (
              <span className="text-xs font-medium text-indigo-600">1순위</span>
            ) : null}
          </li>
        ))}
      </ol>

      {driftsFromCurrent ? (
        <p className="mt-4 border-t border-stone-100 pt-3 text-xs text-stone-500">
          {current ? (
            <>
              현재 등록 기준과 다릅니다 — 지금은{" "}
              {current.contacts.length > 0 ? (
                <span className="text-stone-700">
                  {current.contacts.map((c) => c.name).join(" → ")} (
                  {levelLabel(current.responsibility.level)} 단계)
                </span>
              ) : (
                <span className="text-stone-700">담당자 미등록</span>
              )}{" "}
              ·{" "}
              <Link href={escalationHref} className="underline hover:text-indigo-600">
                순서 편집
              </Link>
            </>
          ) : (
            <>현재 이 계정은 어느 서비스에도 매핑되어 있지 않습니다.</>
          )}
        </p>
      ) : null}
      </div>
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
      <section className="border border-stone-200 border-l-[3px] border-l-[#b54708] bg-white p-6">
        <h2 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-[#b54708]">
          담당 · 조직
        </h2>
        <p className="text-sm text-stone-600">
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
    <section className="border border-stone-200 bg-white">
      <div className="border-b border-stone-200 px-6 py-3">
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">
          담당 · 조직 (현재 등록 기준)
        </h2>
      </div>
      <div className="p-6 pt-4">
      <div className="flex flex-wrap items-center gap-1.5 text-sm text-stone-600">
        <Link
          href={`/admin/customers/${chain.customer.id}`}
          className="font-medium text-stone-800 hover:text-indigo-600 hover:underline"
        >
          {chain.customer.name}
        </Link>
        <span className="font-mono text-xs text-stone-300">›</span>
        <Link
          href={`/admin/projects/${chain.project.id}`}
          className="hover:text-indigo-600 hover:underline"
        >
          {chain.project.name}
        </Link>
        <span className="font-mono text-xs text-stone-300">›</span>
        <Link
          href={`/admin/services/${chain.service.id}`}
          className="hover:text-indigo-600 hover:underline"
        >
          {chain.service.name}
        </Link>
        <span className="font-mono text-xs text-stone-300">›</span>
        <span className="font-mono text-xs">
          {chain.account.alias ?? chain.account.accountId}
        </span>
        {chain.account.environment ? (
          <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-stone-500">
            {chain.account.environment}
          </span>
        ) : null}
      </div>

      {contacts.length === 0 ? (
        <p className="mt-4 text-sm text-stone-400">
          체인 어느 단계에도 담당자가 등록되어 있지 않습니다 —{" "}
          <Link href={escalationHref} className="underline hover:text-indigo-600">
            알람 처리 순서
          </Link>
          에서 등록하세요.
        </p>
      ) : (
        <>
          <p className="mb-2 mt-4 text-xs text-stone-400">
            {levelLabel(responsibility.level)} 단계의 순서가 적용됩니다 (현재 등록
            기준) ·{" "}
            <Link href={escalationHref} className="underline hover:text-indigo-600">
              순서 편집
            </Link>
          </p>
          <ol className="space-y-1.5">
            {contacts.map((c, i) => (
              <li key={c.id} className="flex items-center gap-2 text-sm">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-semibold tabular-nums ${
                    i === 0 ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {i + 1}
                </span>
                <span className={i === 0 ? "font-medium text-stone-900" : "text-stone-700"}>
                  {c.name}
                </span>
                {c.department ? (
                  <span className="text-xs text-stone-400">{c.department}</span>
                ) : null}
                {i === 0 ? (
                  <span className="text-xs font-medium text-indigo-600">1순위</span>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      )}
      </div>
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

  const snapshot = parseOwnershipSnapshot(alert.ownershipSnapshot);

  // P2: 스냅샷이 있으면 뮤트 판정은 스냅샷 체인만으로 충분하다 — 현재 매핑
  // 조회와 병렬로 돌려 왕복을 아낀다. 스냅샷이 없을 때만 순차 폴백.
  const ownershipPromise = alert.accountId
    ? getOwnershipByAwsAccount(alert.accountId)
    : Promise.resolve(null);
  let ownership: Awaited<ReturnType<typeof getOwnershipByAwsAccount>>;
  let activeSilence;
  if (snapshot) {
    [ownership, activeSilence] = await Promise.all([
      ownershipPromise,
      findActiveSilence({
        alertId: alert.id,
        serviceId: snapshot.chain.serviceId,
        projectId: snapshot.chain.projectId,
        customerId: snapshot.chain.customerId,
      }),
    ]);
  } else {
    ownership = await ownershipPromise;
    activeSilence = await findActiveSilence({
      alertId: alert.id,
      serviceId: ownership?.chain.service.id ?? null,
      projectId: ownership?.chain.project.id ?? null,
      customerId: ownership?.chain.customer.id ?? null,
    });
  }

  // 뮤트 폼 좌표: 스냅샷 체인 우선, 없으면 현재 매핑.
  const serviceId =
    snapshot?.chain.serviceId ?? ownership?.chain.service.id ?? null;
  const serviceLabel = snapshot
    ? `${snapshot.chain.customerName} › ${snapshot.chain.projectName} › ${snapshot.chain.serviceName}`
    : ownership
      ? `${ownership.chain.customer.name} › ${ownership.chain.project.name} › ${ownership.chain.service.name}`
      : null;
  const backHref = `/alerts/${alert.id}`;

  const sevTone = severityTone(alert.severity);
  const heroBorder =
    alert.status === "FIRING" ? sevTone.color : statusTone(alert.status).color;

  return (
    <div className="space-y-[18px]">
      <div className="flex items-center gap-2 font-mono text-xs text-stone-400">
        <span>←</span>
        <Link
          href="/"
          className="font-sans text-[13px] font-medium text-indigo-600 hover:underline"
        >
          대시보드
        </Link>
        <span className="font-mono text-xs text-stone-300">›</span>
        <span>{alert.id.slice(0, 8)}</span>
      </div>

      {/* v2 히어로: 좌측 상태색 3px 보더 + 모노 SEV/STATUS 라인 + 큰 제목,
          우측에 액션. */}
      <div
        className="border border-stone-200 bg-white px-6 py-[22px]"
        style={{ borderLeft: `3px solid ${heroBorder}` }}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-7 gap-y-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <SeverityBadge severity={alert.severity} />
              <span className="h-[13px] w-px bg-stone-200" />
              <StatusBadge status={alert.status} />
              <span className="h-[13px] w-px bg-stone-200" />
              <span className="font-mono text-[11px] text-stone-500">
                최초 {formatTime(alert.firstSeenAt)} · {alert.count}회 반복
              </span>
            </div>
            <h1 className="mt-3.5 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-stone-900">
              {alert.title}
            </h1>
            {alert.description ? (
              <p className="mt-2 text-[13px] text-stone-500">
                {alert.description}
              </p>
            ) : null}
          </div>
          <span className="flex flex-none items-start gap-2">
            <AlertActions id={alert.id} status={alert.status} />
            {!activeSilence ? (
              <MuteControl
                alertId={alert.id}
                serviceId={serviceId}
                serviceLabel={serviceLabel}
                backHref={backHref}
              />
            ) : null}
          </span>
        </div>
      </div>

      {activeSilence ? (
        <MutedBanner silence={activeSilence} alertId={alert.id} backHref={backHref} />
      ) : null}

      {snapshot && snapshot.order.length > 0 ? (
        <SnapshotPanel snapshot={snapshot} current={ownership} />
      ) : alert.accountId ? (
        <OwnershipPanel accountId={alert.accountId} info={ownership} />
      ) : null}

      <section className="border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-6 py-3">
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">
            메트릭 · 임계치 · 사유
          </h2>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 p-6 sm:grid-cols-4">
          <Field label="소스" value={alert.source} />
          <Field label="리소스" value={alert.resource} mono />
          <Field label="메트릭" value={alert.metric} mono />
          <Field label="네임스페이스" value={alert.namespace} mono />
          <Field label="현재값" value={alert.value} mono />
          <Field
            label="임계치"
            value={alert.threshold !== null ? String(alert.threshold) : null}
            mono
          />
          <Field label="비교" value={alert.comparison} mono />
          <Field label="리전" value={alert.region} mono />
          <Field label="AWS 계정" value={alert.accountId} mono />
          <Field label="반복" value={`${alert.count}회`} mono />
          <Field label="최초 수신" value={formatTime(alert.firstSeenAt)} mono />
          <Field label="최근 수신" value={formatTime(alert.lastSeenAt)} mono />
        </dl>
        {alert.stateReason ? (
          <div className="mx-6 mb-6 border border-stone-100 bg-stone-50 px-4 py-3.5">
            <dt className="font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">
              발화 사유
            </dt>
            <dd className="mt-2 text-[13px] leading-relaxed text-stone-900">
              {alert.stateReason}
            </dd>
          </div>
        ) : null}
      </section>

      <section className="border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-3">
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">
            통지 이력
          </h2>
          <span className="font-mono text-[11px] text-stone-400">
            {alert.notifications.length}
            {alert.notifyJobs.length > 0
              ? ` · 재시도 대기 ${alert.notifyJobs.length}`
              : ""}
          </span>
        </div>
        {/* 재시도 대기 중인 아웃박스 잡 — 지수 백오프 30s·1m·2m·5m·10m,
            5회 실패 시 포기. */}
        {alert.notifyJobs.length > 0 ? (
          <ul className="divide-y divide-stone-100 border-b border-stone-100 text-sm">
            {alert.notifyJobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-3 bg-stone-50 px-6 py-3">
                <span className="w-14 shrink-0 font-mono text-[11px] uppercase tracking-[0.04em] text-stone-500">
                  {job.channel}
                </span>
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-[0.08em] text-[#b54708]">
                  <Mark color="#b54708" shape="tri" />
                  재시도 {job.attempts}/5
                </span>
                <span className="text-xs text-stone-500">
                  다음 시도{" "}
                  <span className="font-mono">
                    {new Date(job.nextAttemptAt).toISOString().slice(11, 16)}Z
                  </span>
                  {job.lastError ? ` · ${job.lastError}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {/* 빈 상태도 명시한다 — "통지가 안 나간 것"과 "기록이 없는 것"을
            구분할 수 없으면 고객사 입장에서 신뢰가 깎인다 (페르소나 검증 P2). */}
        {alert.notifications.length === 0 && alert.notifyJobs.length === 0 ? (
          <p className="px-6 py-4 text-sm text-stone-400">
            이 알람에 대해 발송된 통지가 없습니다 — 통지 채널이 설정되지
            않았거나, 담당자에게 연락 수단이 없거나, 통지 이력 도입 이전의
            알람입니다.
          </p>
        ) : alert.notifications.length === 0 ? null : (
          <ul className="divide-y divide-stone-100 text-sm">
            {alert.notifications.map((nlog) => (
              <li
                key={nlog.id}
                className="flex flex-wrap items-center gap-3 px-6 py-3.5"
              >
                <span className="w-14 shrink-0 font-mono text-[11px] uppercase tracking-[0.04em] text-stone-500">
                  {nlog.channel}
                </span>
                {nlog.ok ? (
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-[0.08em] text-[#067647]">
                    <Mark color="#067647" shape="check" />
                    발송됨
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-[0.08em] text-[#b42318]">
                    <Mark color="#b42318" shape="dot" />
                    실패
                  </span>
                )}
                <span className="text-[13px] font-medium text-stone-900">
                  {nlog.target ?? "채널 전체"}
                </span>
                <span className="text-xs text-stone-500">
                  {nlog.escalationStep
                    ? `${nlog.escalationStep}순위 에스컬레이션`
                    : "최초 통지"}
                </span>
                <time className="ml-auto font-mono text-xs text-stone-500">
                  {formatTime(nlog.createdAt)}
                </time>
                {nlog.error ? (
                  <p className="w-full pl-[68px] text-xs text-[#b42318]">
                    {nlog.error}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-3">
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">
            이벤트 타임라인
          </h2>
          <span className="font-mono text-[10px] tracking-[0.08em] text-stone-300">
            APPEND-ONLY
          </span>
        </div>
        <ol className="flex flex-col gap-4 px-6 py-5">
          {alert.events.map((ev, i) => {
            const tone = statusTone(ev.status);
            const last = i === alert.events.length - 1;
            return (
              <li key={ev.id} className="grid grid-cols-[12px_1fr] gap-3">
                <div className="flex flex-col items-center pt-1">
                  <Mark {...tone} />
                  {!last ? (
                    <span className="mt-1.5 w-px flex-1 bg-stone-200" style={{ minHeight: 16 }} />
                  ) : null}
                </div>
                <div className="pb-0.5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span
                      className="font-mono text-[10px] font-bold tracking-[0.08em]"
                      style={{ color: tone.color }}
                    >
                      {STATUS_LABELS[ev.status] ?? ev.status}
                    </span>
                    <time className="font-mono text-[11px] text-stone-400">
                      {formatTime(ev.createdAt)}
                    </time>
                  </div>
                  {ev.stateReason ? (
                    <p className="mt-1.5 text-[13px] leading-relaxed text-stone-600">
                      {ev.stateReason}
                    </p>
                  ) : null}
                  {ev.value ? (
                    <p className="mt-0.5 font-mono text-xs text-stone-400">
                      value: {ev.value}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
