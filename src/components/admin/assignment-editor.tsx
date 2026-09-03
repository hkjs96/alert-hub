import { addAssignment, removeAssignment } from "@/server/org-actions";
import {
  getContactChoices,
  getDirectAssignments,
  getTeamChoices,
} from "@/server/org";
import { NewContactInline } from "@/components/admin/new-contact-inline";
import { PendingButton } from "@/components/pending-button";
import type { ScopeLevel } from "@/lib/org/resolve";

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";

/**
 * The 붙였다뗐다 widget: who is registered at this scope, as chips (× to
 * detach), plus add-forms for a person or a team.
 *
 * Deliberately order-blind. Registration answers "who belongs here"; the
 * notification sequence is set on 알람 처리 순서 so the two decisions can be
 * made by different people at different times. Adding an item puts it at the
 * end of the list, which is the harmless default. A team item expands to its
 * members (in the team's own order) at resolution time.
 */
export async function AssignmentEditor({
  level,
  scopeId,
  customerId,
  back,
}: {
  level: ScopeLevel;
  scopeId: string;
  /** Chain's customer — decides which contacts/teams are offered. */
  customerId: string;
  /** Path to revalidate after mutations (current page). */
  back: string;
}) {
  const [assignments, choices, teams] = await Promise.all([
    getDirectAssignments(level, scopeId),
    getContactChoices(customerId),
    getTeamChoices(customerId),
  ]);

  const registeredContacts = new Set(
    assignments.map((a) => a.contactId).filter(Boolean) as string[],
  );
  const registeredTeams = new Set(
    assignments.map((a) => a.teamId).filter(Boolean) as string[],
  );
  const availableContacts = choices.filter((c) => !registeredContacts.has(c.id));
  const availableTeams = teams.filter((t) => !registeredTeams.has(t.id));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {assignments.length === 0 ? (
          <span className="text-sm text-stone-400">
            담당 미지정 (상위에서 상속)
          </span>
        ) : (
          assignments.map((a) => (
            <form key={a.id} action={removeAssignment} className="inline-flex">
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="back" value={back} />
              {a.contact ? (
                <span className="inline-flex h-[26px] items-center gap-1 border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-700">
                  {a.contact.name}
                  {a.contact.department ? (
                    <span className="opacity-60">· {a.contact.department}</span>
                  ) : null}
                  <button
                    type="submit"
                    aria-label={`${a.contact.name} 제외`}
                    className="ml-0.5 px-1 leading-none opacity-60 hover:opacity-100"
                  >
                    ×
                  </button>
                </span>
              ) : a.team ? (
                <span
                  className="inline-flex h-[26px] items-center gap-1 border border-stone-900 bg-stone-900 px-2.5 text-xs font-medium text-white"
                  title={
                    a.team.members.length
                      ? `팀 순서: ${a.team.members.map((m) => m.contact.name).join(" → ")}`
                      : "멤버가 없는 팀 — 해석 시 건너뜁니다"
                  }
                >
                  <span className="font-mono text-[11px] opacity-70">팀</span>
                  {a.team.name}
                  <span className="opacity-60">· {a.team.members.length}명</span>
                  <button
                    type="submit"
                    aria-label={`${a.team.name} 팀 제외`}
                    className="ml-0.5 px-1 leading-none opacity-60 hover:opacity-100"
                  >
                    ×
                  </button>
                </span>
              ) : null}
            </form>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {availableContacts.length > 0 ? (
          <form action={addAssignment} className="flex items-center gap-1.5">
            <input type="hidden" name="level" value={level} />
            <input type="hidden" name="scopeId" value={scopeId} />
            <input type="hidden" name="back" value={back} />
            <select name="contactId" required aria-label="담당자 선택" className={control} defaultValue="">
              <option value="" disabled>
                담당자 선택…
              </option>
              {availableContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.department ? ` (${c.department})` : ""}
                  {c.customerId === null ? " · 내부" : ""}
                </option>
              ))}
            </select>
            <PendingButton
              type="submit"
              pendingLabel="추가 중…"
              className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700"
            >
              + 추가
            </PendingButton>
          </form>
        ) : null}

        {availableTeams.length > 0 ? (
          <form action={addAssignment} className="flex items-center gap-1.5">
            <input type="hidden" name="level" value={level} />
            <input type="hidden" name="scopeId" value={scopeId} />
            <input type="hidden" name="back" value={back} />
            <select name="teamId" required aria-label="팀 선택" className={control} defaultValue="">
              <option value="" disabled>
                팀 선택…
              </option>
              {availableTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t._count.members}명)
                  {t.customerId === null ? " · 내부" : ""}
                </option>
              ))}
            </select>
            <PendingButton
              type="submit"
              pendingLabel="추가 중…"
              className="inline-flex h-8 items-center rounded-md border border-stone-900 bg-white px-3 text-sm font-medium text-stone-900 transition-colors hover:bg-stone-100"
            >
              + 팀 추가
            </PendingButton>
          </form>
        ) : null}

        {availableContacts.length === 0 && availableTeams.length === 0 ? (
          <p className="text-xs text-stone-400">
            이 고객사 / 내부 인원과 팀이 모두 등록되어 있습니다.
          </p>
        ) : null}
      </div>

      <NewContactInline
        level={level}
        scopeId={scopeId}
        customerId={customerId}
        back={back}
      />
    </div>
  );
}
