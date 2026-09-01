import { createContactAndAssign } from "@/server/org-actions";
import type { ScopeLevel } from "@/lib/org/resolve";

/**
 * "+ 새 인원 등록" 인라인 (§6.3/6.4): 멤버 관리로 왕복하지 않고 이 자리에서
 * 사람을 만들고 바로 이 스코프 맨 뒤 순번으로 배정한다. <details>라 JS 없이
 * 접혀 있고, 펼쳐야 폼이 보인다.
 */
export function NewContactInline({
  level,
  scopeId,
  customerId,
  customerName,
  back,
}: {
  level: ScopeLevel;
  scopeId: string;
  /** Chain's customer — the only customer the new person may be attached to. */
  customerId: string;
  customerName?: string;
  back: string;
}) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-stone-500 hover:text-indigo-600">
        + 새 인원 등록 (등록과 동시에 맨 뒤 순번으로 배정)
      </summary>
      <form
        action={createContactAndAssign}
        className="mt-2 flex flex-wrap items-center gap-1.5"
      >
        <input type="hidden" name="level" value={level} />
        <input type="hidden" name="scopeId" value={scopeId} />
        <input type="hidden" name="customerId" value={customerId} />
        <input type="hidden" name="back" value={back} />
        <input
          name="name"
          required
          placeholder="이름"
          aria-label="이름"
          className="w-28 h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400"
        />
        <input
          name="department"
          placeholder="부서 (선택)"
          aria-label="부서"
          className="w-28 h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400"
        />
        <input
          name="email"
          type="email"
          placeholder="이메일 (선택)"
          aria-label="이메일"
          className="w-44 h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400"
        />
        <select
          name="affiliation"
          aria-label="소속"
          defaultValue="customer"
          className="h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400"
        >
          <option value="customer">{customerName ?? "이 고객사"} 소속</option>
          <option value="internal">내부(MSP)</option>
        </select>
        <button className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700">
          등록 + 배정
        </button>
      </form>
    </details>
  );
}
