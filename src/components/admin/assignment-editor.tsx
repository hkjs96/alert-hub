import { addAssignment, removeAssignment } from "@/server/org-actions";
import { getContactChoices, getDirectAssignments } from "@/server/org";
import type { ScopeLevel } from "@/lib/org/resolve";

const KIND_LABEL: Record<string, string> = {
  OWNER: "정",
  DEPUTY: "부",
  MEMBER: "멤버",
};

const KIND_STYLE: Record<string, string> = {
  OWNER: "bg-blue-600 text-white",
  DEPUTY: "bg-blue-100 text-blue-800",
  MEMBER: "bg-slate-100 text-slate-700",
};

/**
 * The 붙였다뗐다 widget: current assignments as chips (× to detach) and an
 * add-form whose contact dropdown is grouped — this customer's people +
 * internal people first, everyone else after.
 */
export async function AssignmentEditor({
  level,
  scopeId,
  customerId,
  back,
}: {
  level: ScopeLevel;
  scopeId: string;
  /** Chain's customer — used to group the dropdown candidates. */
  customerId: string;
  /** Path to revalidate after mutations (current page). */
  back: string;
}) {
  const [assignments, choices] = await Promise.all([
    getDirectAssignments(level, scopeId),
    getContactChoices(customerId),
  ]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {assignments.length === 0 ? (
          <span className="text-sm text-slate-400">담당 미지정 (상위에서 상속)</span>
        ) : (
          assignments.map((a: any) => (
            <form key={a.id} action={removeAssignment} className="inline-flex">
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="back" value={back} />
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${KIND_STYLE[a.kind] ?? KIND_STYLE.MEMBER}`}
              >
                <span className="opacity-70">{KIND_LABEL[a.kind] ?? a.kind}</span>
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

      <form action={addAssignment} className="flex flex-wrap items-center gap-1.5 text-sm">
        <input type="hidden" name="level" value={level} />
        <input type="hidden" name="scopeId" value={scopeId} />
        <input type="hidden" name="back" value={back} />
        <select
          name="contactId"
          required
          className="rounded-md border border-slate-300 bg-white px-2 py-1"
          defaultValue=""
        >
          <option value="" disabled>
            인원 선택…
          </option>
          {choices.near.length > 0 && (
            <optgroup label="이 고객사 / 내부 인원">
              {choices.near.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.department ? ` (${c.department})` : ""}
                </option>
              ))}
            </optgroup>
          )}
          {choices.far.length > 0 && (
            <optgroup label="다른 고객사 인원">
              {choices.far.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.customer?.name ?? "?"})
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <select
          name="kind"
          className="rounded-md border border-slate-300 bg-white px-2 py-1"
          defaultValue="MEMBER"
        >
          <option value="OWNER">정 담당 (교체됨)</option>
          <option value="DEPUTY">부 담당</option>
          <option value="MEMBER">멤버</option>
        </select>
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-2.5 py-1 text-white hover:bg-slate-700"
        >
          + 추가
        </button>
      </form>
    </div>
  );
}
