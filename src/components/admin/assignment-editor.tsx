import { addAssignment, removeAssignment } from "@/server/org-actions";
import { getContactChoices, getDirectAssignments } from "@/server/org";
import { NewContactInline } from "@/components/admin/new-contact-inline";
import type { ScopeLevel } from "@/lib/org/resolve";

/**
 * The 붙였다뗐다 widget: who is registered at this scope, as chips (× to
 * detach), plus an add-form.
 *
 * Deliberately order-blind. Registration answers "who belongs here"; the
 * notification sequence is set on 알람 처리 순서 so the two decisions can be
 * made by different people at different times. Adding someone here puts them at
 * the end of the list, which is the harmless default.
 */
export async function AssignmentEditor({
  level,
  scopeId,
  customerId,
  back,
}: {
  level: ScopeLevel;
  scopeId: string;
  /** Chain's customer — decides which contacts are offered. */
  customerId: string;
  /** Path to revalidate after mutations (current page). */
  back: string;
}) {
  const [assignments, choices] = await Promise.all([
    getDirectAssignments(level, scopeId),
    getContactChoices(customerId),
  ]);

  const registered = new Set(assignments.map((a) => a.contactId));
  const available = choices.filter((c) => !registered.has(c.id));

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
              <span className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-white px-2.5 py-0.5 text-xs font-medium text-stone-700">
                {a.contact.name}
                {a.contact.department ? (
                  <span className="opacity-60">· {a.contact.department}</span>
                ) : null}
                <button
                  type="submit"
                  aria-label={`${a.contact.name} 제외`}
                  className="ml-0.5 rounded-full px-1 leading-none opacity-60 hover:opacity-100"
                >
                  ×
                </button>
              </span>
            </form>
          ))
        )}
      </div>

      {available.length > 0 ? (
        <form
          action={addAssignment}
          className="flex flex-wrap items-center gap-1.5 text-sm"
        >
          <input type="hidden" name="level" value={level} />
          <input type="hidden" name="scopeId" value={scopeId} />
          <input type="hidden" name="back" value={back} />
          <select
            name="contactId"
            required
            aria-label="담당자 선택"
            className="h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400"
            defaultValue=""
          >
            <option value="" disabled>
              담당자 선택…
            </option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.department ? ` (${c.department})` : ""}
                {c.customerId === null ? " · 내부" : ""}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700"
          >
            + 추가
          </button>
        </form>
      ) : (
        <p className="text-xs text-stone-400">
          이 고객사 / 내부 인원이 모두 등록되어 있습니다.
        </p>
      )}

      <NewContactInline
        level={level}
        scopeId={scopeId}
        customerId={customerId}
        back={back}
      />
    </div>
  );
}
