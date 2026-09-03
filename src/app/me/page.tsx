import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { readAuthConfig } from "@/lib/auth/config";
import { getCurrentUser } from "@/server/auth";
import { updateMyProfile } from "@/server/me-actions";
import { PendingButton } from "@/components/pending-button";
import { ChannelBadges } from "@/components/admin/contact-roster";

export const dynamic = "force-dynamic";

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";
const overline = "font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400";

/**
 * 내 통지 프로필 — SSO로 들어온 내부 인원이 자기 Slack ID·전화를 채우는 곳.
 * 관리자가 대신 입력하던 것을 본인 손으로 옮긴다. 배정·팀 소속은 읽기 전용.
 */
export default async function MePage({
  searchParams,
}: {
  searchParams: { welcome?: string; saved?: string };
}) {
  const cfg = readAuthConfig();
  const me = await getCurrentUser();

  if (!me) {
    return (
      <div className="mx-auto mt-16 max-w-md space-y-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-stone-900">내 통지 프로필</h1>
        <p className="text-sm text-stone-500">
          {cfg.enabled
            ? "로그인하면 자기 Slack ID·전화번호를 직접 관리할 수 있습니다."
            : "SSO가 켜지면 여기서 각자 자기 통지 프로필을 채웁니다. 지금은 관리자가 팀 · 내부 인원 화면에서 대신 입력합니다."}
        </p>
        <Link
          href={cfg.enabled ? "/login?next=/me" : "/admin/teams"}
          className="inline-flex h-9 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white"
        >
          {cfg.enabled ? "로그인" : "팀 · 내부 인원으로 →"}
        </Link>
      </div>
    );
  }

  const full = await prisma.contact.findUnique({
    where: { id: me.id },
    include: {
      teamMemberships: { include: { team: { select: { name: true } } } },
      _count: { select: { assignments: true } },
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-[27px] font-semibold leading-tight tracking-[-0.025em] text-stone-900">
          내 통지 프로필
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          <span className="font-mono text-xs">{me.email}</span> · 내부 인원
        </p>
      </div>

      {searchParams.welcome ? (
        <p className="border border-stone-900 bg-stone-900 px-3 py-2.5 text-sm text-white">
          처음 오셨네요. 내부 인원으로 등록됐습니다 — Slack 멤버 ID와 전화번호를 채워야 알람 순서에서
          실제로 연락을 받을 수 있습니다.
        </p>
      ) : null}
      {searchParams.saved ? (
        <p className="border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">저장했습니다.</p>
      ) : null}
      {me.profileIncomplete && !searchParams.welcome ? (
        <p className="border border-[#f0d9a8] bg-[#fdf8ec] px-3 py-2 text-sm text-[#8a5a00]">
          통지 채널이 비어 있습니다. Slack ID 또는 전화번호 중 하나는 있어야 순서에 넣을 수 있습니다.
        </p>
      ) : null}

      <form action={updateMyProfile} className="space-y-4 border border-stone-200 bg-white p-5 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={`mb-1 block ${overline}`}>이름</span>
            <input name="name" defaultValue={me.name} required className={`${control} w-full`} />
          </label>
          <label className="block">
            <span className={`mb-1 block ${overline}`}>부서 (선택)</span>
            <input name="department" defaultValue={me.department ?? ""} placeholder="SRE팀" className={`${control} w-full`} />
          </label>
          <label className="block">
            <span className={`mb-1 block ${overline}`}>Slack 멤버 ID</span>
            <input name="slackId" defaultValue={me.slackId ?? ""} placeholder="U0123ABC" className={`${control} w-full font-mono`} />
            <span className="mt-1 block text-xs text-stone-400">Slack 프로필 → ⋯ → 멤버 ID 복사</span>
          </label>
          <label className="block">
            <span className={`mb-1 block ${overline}`}>전화 (E.164)</span>
            <input name="phone" defaultValue={me.phone ?? ""} placeholder="+8210…" className={`${control} w-full font-mono`} />
            <span className="mt-1 block text-xs text-stone-400">에스컬레이션 SMS/전화에 쓰입니다</span>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <PendingButton
            pendingLabel="저장 중…"
            className="inline-flex h-8 items-center rounded-md bg-stone-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-stone-700"
          >
            저장
          </PendingButton>
          <span className="text-xs text-stone-400">현재 채널:</span>
          {full ? <ChannelBadges c={full} /> : null}
        </div>
      </form>

      <section className="space-y-2 text-sm">
        <div className={overline}>내 배정</div>
        <p className="text-stone-600">
          스코프 배정 {full?._count.assignments ?? 0}곳
          {full?.teamMemberships.length
            ? ` · 팀 ${full.teamMemberships.map((m) => m.team.name).join(", ")}`
            : ""}
          {" — "}
          배정과 순서는 <Link href="/admin/escalation" className="text-indigo-600 underline">알람 처리 순서</Link>에서 관리합니다.
        </p>
      </section>
    </div>
  );
}
