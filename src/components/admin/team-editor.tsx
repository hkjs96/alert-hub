import { prisma } from "@/lib/prisma";
import {
  addTeamMember,
  deleteTeam,
  moveTeamMember,
  removeTeamMember,
  renameTeam,
} from "@/server/org-actions";
import { PendingButton } from "@/components/pending-button";
import { DangerDelete } from "@/components/admin/danger-delete";

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";
const iconBtn =
  "inline-flex h-6 w-6 items-center justify-center rounded-md border border-stone-300 bg-white text-xs text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-35 disabled:hover:bg-white";

/**
 * 팀 하나의 편집기: 이름, 순번 있는 멤버 목록(↑↓×), 멤버 추가. 멤버 후보는
 * 내부 인원 + (고객사 팀이면) 그 고객사 인원 — 배정 드롭다운과 같은 규칙.
 */
export async function TeamEditor({ teamId, back }: { teamId: string; back: string }) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      customer: true,
      members: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        include: { contact: true },
      },
      _count: { select: { assignments: true } },
    },
  });
  if (!team) return null;

  const choices = await prisma.contact.findMany({
    where: { active: true, OR: [{ customerId: null }, ...(team.customerId ? [{ customerId: team.customerId }] : [])] },
    orderBy: { name: "asc" },
  });
  const inTeam = new Set(team.members.map((m) => m.contactId));
  const available = choices.filter((c) => !inTeam.has(c.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form action={renameTeam} className="flex items-center gap-1.5">
          <input type="hidden" name="id" value={team.id} />
          <input type="hidden" name="back" value={back} />
          <input name="name" defaultValue={team.name} required className={`${control} w-44 font-semibold`} aria-label="팀 이름" />
          <PendingButton pendingLabel="저장 중…" className="inline-flex h-8 items-center rounded-md border border-stone-300 bg-white px-2.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50">
            이름 저장
          </PendingButton>
        </form>
        <span className="text-xs text-stone-400">
          {team.customer ? `${team.customer.name} 전용` : "내부 공용"} · 배정된 스코프 {team._count.assignments}곳
        </span>
        <span className="ml-auto">
          <DangerDelete
            action={deleteTeam}
            id={team.id}
            back={back}
            subject={`${team.name} 팀`}
            impact={
              team._count.assignments > 0
                ? `이 팀을 참조하던 스코프 배정 ${team._count.assignments}곳(해당 스코프는 상위 상속으로 복귀)`
                : undefined
            }
          />
        </span>
      </div>

      <ol className="space-y-1">
        {team.members.length === 0 ? (
          <li className="text-sm text-stone-400">
            멤버가 없습니다 — 멤버 없는 팀은 해석 시 건너뜁니다.
          </li>
        ) : null}
        {team.members.map((m, i) => (
          <li key={m.id} className="flex items-center gap-2 bg-stone-50 px-2.5 py-1.5 text-sm">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center bg-stone-900 font-mono text-[11px] font-bold text-white">
              {i + 1}
            </span>
            <span className={`font-medium ${m.contact.active ? "text-stone-900" : "text-stone-400 line-through"}`}>{m.contact.name}</span>
            {!m.contact.active ? (
              <span className="border border-stone-200 px-1 font-mono text-[11px] text-stone-400" title="해석 시 건너뜁니다">비활성</span>
            ) : null}
            {m.contact.department ? (
              <span className="text-xs text-stone-400">{m.contact.department}</span>
            ) : null}
            <span className="ml-auto flex items-center gap-1">
              <form action={moveTeamMember} className="inline">
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="direction" value="up" />
                <input type="hidden" name="back" value={back} />
                <button aria-label={`${m.contact.name} 올리기`} disabled={i === 0} className={iconBtn}>↑</button>
              </form>
              <form action={moveTeamMember} className="inline">
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="direction" value="down" />
                <input type="hidden" name="back" value={back} />
                <button aria-label={`${m.contact.name} 내리기`} disabled={i === team.members.length - 1} className={iconBtn}>↓</button>
              </form>
              <form action={removeTeamMember} className="inline">
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="back" value={back} />
                <button aria-label={`${m.contact.name} 제외`} className="px-1 text-stone-400 hover:text-[#b42318]">×</button>
              </form>
            </span>
          </li>
        ))}
      </ol>

      {available.length > 0 ? (
        <form action={addTeamMember} className="flex flex-wrap items-center gap-1.5 text-sm">
          <input type="hidden" name="teamId" value={team.id} />
          <input type="hidden" name="back" value={back} />
          <select name="contactId" required defaultValue="" aria-label="멤버 추가" className={control}>
            <option value="" disabled>멤버 추가 (맨 뒤 순번으로)…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.department ? ` (${c.department})` : ""}{c.customerId === null ? " · 내부" : ""}
              </option>
            ))}
          </select>
          <PendingButton pendingLabel="추가 중…" className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700">
            + 멤버
          </PendingButton>
        </form>
      ) : (
        <p className="text-xs text-stone-400">추가할 수 있는 인원이 모두 팀에 있습니다.</p>
      )}
    </div>
  );
}
