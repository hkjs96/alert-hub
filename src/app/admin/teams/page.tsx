import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createTeam } from "@/server/org-actions";
import { ContactRoster } from "@/components/admin/contact-roster";
import { TeamEditor } from "@/components/admin/team-editor";
import { PendingButton } from "@/components/pending-button";

export const dynamic = "force-dynamic";

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";

/**
 * 팀 · 내부 인원 — MSP 쪽 사람과 묶음을 다루는 곳. 고객사 담당자는 조직
 * 트리의 고객사 패널로 옮겨갔고, 여기엔 (1) 어느 고객사에나 배정할 수 있는
 * 내부 공용 팀, (2) 고객사 전용 팀의 요약, (3) 내부 인원 명단이 남는다.
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
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-stone-900">팀 · 내부 인원</h1>
        <p className="mt-1 text-sm text-stone-500">
          팀은 알람 처리 순서에 한 칸으로 들어가고, 해석할 때 팀 순서대로 멤버가 펼쳐집니다.
          인프라팀 · DB팀처럼 기능 단위로 나누는 고객사는 팀을, 프로젝트 단위로 나누는 고객사는
          개인 배정을 쓰면 됩니다. 고객사 담당자는{" "}
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
            아직 내부 팀이 없습니다. 위에서 만들고 멤버를 순서대로 넣으세요.
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

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-sm font-semibold text-stone-900">내부 인원</h2>
          <span className="text-xs text-stone-400">고객사에 속하지 않은 MSP 담당자</span>
        </div>
        <ContactRoster scope="internal" back={back} />
      </section>
    </div>
  );
}
