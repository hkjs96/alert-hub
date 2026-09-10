import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createTeam } from "@/server/org-actions";
import { TeamEditor } from "@/components/admin/team-editor";
import { PendingButton } from "@/components/pending-button";

export const dynamic = "force-dynamic";

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";

/**
 * 팀 · 온콜 — 사람 묶음과 순번, 시간대 온콜(시프트). (1) 어느 고객사에나 배정할 수
 * 있는 내부 공용 팀, (2) 고객사 전용 팀의 요약. 인원·역할·승인은 계정 · 접근에.
 */
export default async function TeamsPage() {
  const teams = await prisma.team.findMany({
    orderBy: [{ customerId: "asc" }, { name: "asc" }],
    include: { customer: true, _count: { select: { members: true, assignments: true } } },
  });
  const internal = teams.filter((t) => t.customerId === null);
  const customerTeams = teams.filter((t) => t.customerId !== null);
  const back = "/admin/teams";

  return (
    <div className="space-y-[26px]">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-stone-900">팀 · 온콜</h1>
        <p className="mt-1 text-sm text-stone-500">
          팀은 알람 처리 순서에 한 칸으로 들어가고, 해석할 때 팀 순서대로 멤버가 펼쳐집니다.
          인프라팀 · DB팀처럼 기능 단위로 나누는 고객사는 팀을, 프로젝트 단위로 나누는 고객사는
          개인 배정을 쓰면 됩니다. 주간 · 야간 · 주말로 당번이 다르면 팀 안의 <b>시간대 온콜</b>(시프트 · 대체 근무)로
          나눕니다. 팀에 넣을 내부 인원은{" "}
          <Link href="/admin/access" className="text-indigo-600 underline">계정 · 접근</Link>에서, 고객사 담당자는{" "}
          <Link href="/admin/org" className="text-indigo-600 underline">조직 트리</Link>에서 관리합니다.
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-sm font-semibold text-stone-900">내부 공용 팀</h2>
          <span className="text-xs text-stone-400">
            어느 고객사 스코프에도 배정할 수 있습니다 · {internal.length}개
          </span>
        </div>
        <form action={createTeam} className="flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="back" value={back} />
          <input
            name="name"
            required
            placeholder="새 팀 이름 (예: 인프라팀, 야간 당직)"
            aria-label="새 팀 이름"
            className={`${control} w-64`}
          />
          <PendingButton
            pendingLabel="만드는 중…"
            className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700"
          >
            + 팀 만들기
          </PendingButton>
        </form>
        {internal.length === 0 ? (
          <p className="border border-dashed border-stone-200 px-3 py-4 text-sm text-stone-400">
            아직 내부 팀이 없습니다. 위에서 만들고 멤버를 순서대로 넣으세요. 시간대별 당번(시프트 · 대체 근무)은 팀 블록 안에서 설정합니다.
          </p>
        ) : (
          <div className="divide-y divide-stone-200 border border-stone-200 bg-white">
            {internal.map((t) => (
              <div key={t.id} className="p-3">
                <TeamEditor teamId={t.id} back={back} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-sm font-semibold text-stone-900">고객사 전용 팀</h2>
          <span className="text-xs text-stone-400">
            해당 고객사 패널에서 편집 · {customerTeams.length}개
          </span>
        </div>
        {customerTeams.length === 0 ? (
          <p className="text-sm text-stone-400">고객사 전용 팀이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-stone-200 border border-stone-200 bg-white text-sm">
            {customerTeams.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="font-mono text-[11px] text-stone-400">팀</span>
                <span className="font-medium text-stone-900">{t.name}</span>
                <span className="text-xs text-stone-400">
                  {t._count.members}명 · 배정 {t._count.assignments}곳
                </span>
                <Link
                  href={`/admin/org?level=customer&id=${t.customerId}`}
                  className="ml-auto text-xs text-indigo-600 underline"
                >
                  {t.customer?.name} 패널 →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

    </div>
  );
}
