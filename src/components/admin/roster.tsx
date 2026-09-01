import { getRoster } from "@/server/org";

/**
 * Rollup view: everyone involved with this scope — directly attached rows plus
 * rows attached to descendants ("프로젝트 A의 사람들 = 홍길동(직접) + 김또깡(↳ A.b)").
 *
 * The 순번 badge is the person's position in *their own* scope's list, which is
 * why a rolled-up row can show 1 alongside a direct row that also shows 1 —
 * they are 1순위 of different lists.
 */
export async function Roster({
  level,
  id,
}: {
  level: "customer" | "project" | "service";
  id: string;
}) {
  const roster = await getRoster(level, id);
  if (roster.length === 0) {
    return <p className="text-sm text-stone-400">관련 인원이 아직 없습니다.</p>;
  }
  return (
    <ul className="divide-y divide-stone-100 text-sm">
      {roster.map((r) => (
        <li key={r.assignmentId} className="flex items-center gap-2 py-1.5">
          <span
            className="w-6 shrink-0 text-center text-xs font-semibold tabular-nums text-stone-500"
            title={`${r.via === "직접" ? "이 단계" : r.via} ${r.order + 1}순위`}
          >
            {r.order + 1}
          </span>
          <span className="font-medium text-stone-800">{r.contact.name}</span>
          {r.contact.department ? (
            <span className="text-stone-400">{r.contact.department}</span>
          ) : null}
          <span
            className={`ml-auto text-xs ${r.direct ? "text-stone-400" : "text-blue-500"}`}
          >
            {r.via}
          </span>
        </li>
      ))}
    </ul>
  );
}
