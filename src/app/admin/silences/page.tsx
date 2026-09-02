import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSilencesForDisplay } from "@/server/silences";
import { createSilence, revokeSilence } from "@/server/silence-actions";
import { silenceStatus, type SilenceStatus } from "@/lib/silence";
import { Mark } from "@/components/badges";

export const dynamic = "force-dynamic";

// v2 프레임 04 (점검 · 뮤트 관리). 스코프 픽커는 escalation 페이지와 같은
// GET 패턴 — 종속 셀렉트는 JS 없이 서로를 좁힐 수 없으니 '이동'으로 한 번에
// 적용하고, 실제 등록 POST는 그 좁혀진 체인 위에서 범위 라디오로 고른다.

const STATUS_LABEL: Record<SilenceStatus, string> = {
  active: "진행 중",
  scheduled: "예약",
  ended: "종료",
  revoked: "해제됨",
};

const STATUS_TONE: Record<SilenceStatus, { color: string; shape: "ring" | "dash" | "check" }> = {
  active: { color: "#4a5568", shape: "ring" },
  scheduled: { color: "#8a877f", shape: "dash" },
  ended: { color: "#067647", shape: "check" },
  revoked: { color: "#8a877f", shape: "check" },
};

function fmtStamp(d: Date): string {
  return d.toISOString().slice(5, 16).replace("T", " ") + "Z";
}

function fmtRange(startsAt: Date, endsAt: Date): string {
  const sameDay = startsAt.toISOString().slice(0, 10) === endsAt.toISOString().slice(0, 10);
  const end = sameDay ? endsAt.toISOString().slice(11, 16) + "Z" : fmtStamp(endsAt);
  return `${fmtStamp(startsAt)} → ${end}`;
}

function fmtRemain(status: SilenceStatus, s: { startsAt: Date; endsAt: Date; revokedAt: Date | null }, now: Date): string {
  const span = (ms: number) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
  };
  if (status === "active") return `${span(s.endsAt.getTime() - now.getTime())} 남음`;
  if (status === "scheduled") return `${span(s.startsAt.getTime() - now.getTime())} 후 시작`;
  if (status === "revoked" && s.revokedAt)
    return `${span(now.getTime() - s.revokedAt.getTime())} 전 해제`;
  return `${span(now.getTime() - s.endsAt.getTime())} 전 종료`;
}

type Filter = "all" | "active" | "scheduled" | "ended";

export default async function SilencesPage({
  searchParams,
}: {
  searchParams: { customerId?: string; projectId?: string; serviceId?: string; f?: string };
}) {
  const now = new Date();
  const filter: Filter = ["active", "scheduled", "ended"].includes(searchParams.f ?? "")
    ? (searchParams.f as Filter)
    : "all";

  const customers = await prisma.customer.findMany({ orderBy: { name: "asc" } });
  const customer =
    customers.find((c) => c.id === searchParams.customerId) ?? customers[0] ?? null;
  const projects = customer
    ? await prisma.project.findMany({
        where: { customerId: customer.id },
        orderBy: { name: "asc" },
      })
    : [];
  const project =
    projects.find((p) => p.id === searchParams.projectId) ?? projects[0] ?? null;
  const services = project
    ? await prisma.service.findMany({
        where: { projectId: project.id },
        orderBy: { name: "asc" },
      })
    : [];
  const service =
    services.find((s) => s.id === searchParams.serviceId) ?? services[0] ?? null;

  const rows = (await getSilencesForDisplay()).map((s) => {
    const status = silenceStatus(s, now);
    const scopeName = s.service
      ? `${s.service.project.customer.name} › ${s.service.project.name} › ${s.service.name}`
      : s.project
        ? `${s.project.customer.name} › ${s.project.name}`
        : s.customer
          ? s.customer.name
          : (s.alert?.title ?? "(삭제된 알람)");
    const kind = s.service
      ? "점검 창 · 서비스 전체"
      : s.project
        ? "점검 창 · 프로젝트 전체"
        : s.customer
          ? "점검 창 · 고객사 전체"
          : "알람 단위 뮤트";
    return { s, status, scopeName, kind };
  });

  const counts = {
    all: rows.length,
    active: rows.filter((r) => r.status === "active").length,
    scheduled: rows.filter((r) => r.status === "scheduled").length,
    ended: rows.filter((r) => r.status === "ended" || r.status === "revoked").length,
  };
  const visible = rows.filter((r) =>
    filter === "all"
      ? true
      : filter === "ended"
        ? r.status === "ended" || r.status === "revoked"
        : r.status === filter,
  );

  const pickerQuery = (over: Partial<Record<string, string>> = {}) => {
    const params = new URLSearchParams({
      ...(customer ? { customerId: customer.id } : {}),
      ...(project ? { projectId: project.id } : {}),
      ...(service ? { serviceId: service.id } : {}),
      ...(filter !== "all" ? { f: filter } : {}),
      ...over,
    });
    const qs = params.toString();
    return qs ? `/admin/silences?${qs}` : "/admin/silences";
  };
  const back = pickerQuery();

  const FILTER_TABS: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "전체", count: counts.all },
    { key: "active", label: "진행 중", count: counts.active },
    { key: "scheduled", label: "예약", count: counts.scheduled },
    { key: "ended", label: "종료", count: counts.ended },
  ];

  const control =
    "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";

  return (
    <div className="space-y-[18px]">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-stone-900">
          점검 · 뮤트
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          점검 창이 열려 있는 동안 스코프 하위 모든 알람의 통지·에스컬레이션이
          멈춥니다. 수집과 상태 전이는 계속되고, 알람은 대시보드에 뮤트 칩과 함께
          그대로 보입니다.
        </p>
      </div>

      <section className="border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-3">
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">
            새 점검 창 등록
          </h2>
        </div>
        <div className="space-y-4 p-5">
          {customer ? (
            <>
              <form method="get" className="flex flex-wrap items-center gap-1.5 text-sm">
                {filter !== "all" && <input type="hidden" name="f" value={filter} />}
                <select name="customerId" aria-label="고객사" defaultValue={customer.id} className={control}>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="font-mono text-xs text-stone-300">›</span>
                <select
                  name="projectId"
                  aria-label="프로젝트"
                  defaultValue={project?.id ?? ""}
                  disabled={projects.length === 0}
                  className={`${control} disabled:bg-stone-50 disabled:text-stone-300`}
                >
                  {projects.length === 0 && <option value="">프로젝트 없음</option>}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <span className="font-mono text-xs text-stone-300">›</span>
                <select
                  name="serviceId"
                  aria-label="서비스"
                  defaultValue={service?.id ?? ""}
                  disabled={services.length === 0}
                  className={`${control} disabled:bg-stone-50 disabled:text-stone-300`}
                >
                  {services.length === 0 && <option value="">서비스 없음</option>}
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button className="inline-flex h-8 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50">
                  이동
                </button>
              </form>

              <form action={createSilence} className="space-y-4 border-t border-stone-100 pt-4 text-sm">
                <input type="hidden" name="back" value={back} />
                <div>
                  <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">
                    범위
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {service ? (
                      <label className="flex items-center gap-1.5">
                        <input type="radio" name="levelScope" value={`service:${service.id}`} defaultChecked required />
                        <span className="font-medium text-stone-900">{service.name}</span>
                        <span className="text-xs text-stone-400">서비스</span>
                      </label>
                    ) : null}
                    {project ? (
                      <label className="flex items-center gap-1.5">
                        <input type="radio" name="levelScope" value={`project:${project.id}`} defaultChecked={!service} required />
                        <span className="text-stone-700">{project.name} 전체</span>
                        <span className="text-xs text-stone-400">프로젝트</span>
                      </label>
                    ) : null}
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="levelScope" value={`customer:${customer.id}`} defaultChecked={!service && !project} required />
                      <span className="text-stone-700">{customer.name} 전체</span>
                      <span className="text-xs text-stone-400">고객사</span>
                    </label>
                  </div>
                </div>

                <div>
                  <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">
                    기간 (UTC)
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="preset" value="1h" defaultChecked required />
                      1시간
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="preset" value="today23" required />
                      오늘 23:00Z
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="preset" value="custom" required />
                      기간 지정
                    </label>
                    <span className="flex items-center gap-1.5 text-xs text-stone-500">
                      <input type="datetime-local" name="startsAt" aria-label="시작 (UTC)" className={`${control} text-xs`} />
                      →
                      <input type="datetime-local" name="endsAt" aria-label="종료 (UTC)" className={`${control} text-xs`} />
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-stone-400">
                    기간 지정 시 시작을 비우면 지금부터. 시각은 UTC(Z) 기준입니다 —
                    시작을 미래로 두면 예약 점검 창이 됩니다.
                  </p>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <label className="block min-w-64 flex-1">
                    <span className="mb-1 flex items-center gap-2">
                      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">
                        사유
                      </span>
                      <span className="font-mono text-[10px] font-bold tracking-[0.08em] text-[#b42318]">
                        필수
                      </span>
                    </span>
                    <input
                      name="reason"
                      required
                      placeholder="예) 결제 게이트웨이 정기 배포 (CHG-2431)"
                      className={`${control} w-full`}
                    />
                  </label>
                  <label className="block w-36">
                    <span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">
                      등록자 (선택)
                    </span>
                    <input name="createdBy" placeholder="이름" className={`${control} w-full`} />
                  </label>
                  <button className="inline-flex h-8 items-center rounded-md bg-stone-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-stone-700">
                    점검 창 등록
                  </button>
                </div>
                <p className="text-xs text-stone-400">
                  등록 즉시(또는 예약 시작 시점부터) 스코프 하위 모든 알람의 통지가
                  멈춥니다. 수집·상태 전이는 계속됩니다.
                </p>
              </form>
            </>
          ) : (
            <p className="text-sm text-stone-400">
              아직 고객사가 없습니다.{" "}
              <Link href="/admin/customers" className="underline hover:text-indigo-600">
                조직 · 담당자 관리
              </Link>
              에서 먼저 등록하세요.
            </p>
          )}
        </div>
      </section>

      <section className="border border-stone-200 bg-white">
        <div className="flex items-center gap-2 border-b border-stone-200 px-5 py-3">
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">
            점검 창 · 뮤트 일람
          </h2>
          <div className="ml-auto flex border border-stone-200 text-xs">
            {FILTER_TABS.map((t) => (
              <Link
                key={t.key}
                href={pickerQuery({ f: t.key === "all" ? "" : t.key })}
                className={`flex h-[26px] items-center border-l border-stone-200 px-3 first:border-l-0 ${
                  filter === t.key
                    ? "bg-stone-900 font-semibold text-white"
                    : "font-medium text-stone-500 hover:text-stone-900"
                }`}
              >
                {t.label} {t.count}
              </Link>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="px-5 py-4 text-sm text-stone-400">
            {filter === "all"
              ? "등록된 점검 창·뮤트가 없습니다."
              : "이 상태의 점검 창·뮤트가 없습니다."}
          </p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {visible.map(({ s, status, scopeName, kind }) => {
              const tone = STATUS_TONE[status];
              const done = status === "ended" || status === "revoked";
              return (
                <li
                  key={s.id}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 ${
                    done ? "bg-stone-50" : ""
                  }`}
                >
                  <span
                    className="inline-flex w-20 items-center gap-1.5 font-mono text-[10px] font-bold tracking-[0.08em]"
                    style={{ color: done ? "#9a978f" : tone.color }}
                  >
                    <Mark color={done ? "#b8b2a4" : tone.color} shape={tone.shape} />
                    {STATUS_LABEL[status]}
                  </span>
                  <span className="min-w-52 flex-1">
                    <span className="block text-[13px] font-medium text-stone-900">
                      {scopeName}
                    </span>
                    <span className="block text-[11px] text-stone-400">{kind}</span>
                  </span>
                  <span className="w-52">
                    <span className="block font-mono text-xs text-stone-600">
                      {fmtRange(s.startsAt, s.endsAt)}
                    </span>
                    <span className="block text-[11px] text-stone-400">
                      {fmtRemain(status, s, now)}
                    </span>
                  </span>
                  <span
                    className="w-64 truncate text-[13px] text-stone-600"
                    title={s.reason}
                  >
                    {s.reason}
                  </span>
                  <span className="w-20 text-[13px] text-stone-600">
                    {s.createdBy ?? "—"}
                  </span>
                  <span className="ml-auto">
                    {status === "active" || status === "scheduled" ? (
                      <form action={revokeSilence} className="inline">
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="back" value={back} />
                        <button className="inline-flex h-[26px] items-center border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-900 transition-colors hover:border-stone-400">
                          {status === "active" ? "지금 해제" : "취소"}
                        </button>
                      </form>
                    ) : (
                      <span className="inline-flex h-[26px] cursor-not-allowed items-center border border-stone-100 bg-stone-100 px-2.5 text-xs font-medium text-stone-400">
                        {status === "revoked" ? "해제됨" : "종료"}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
