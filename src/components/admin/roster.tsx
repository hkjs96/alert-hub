import { getRoster } from "@/server/org";

const KIND_LABEL: Record<string, string> = {
  OWNER: "정",
  DEPUTY: "부",
  MEMBER: "멤버",
};

/**
 * Rollup view: everyone involved with this scope — directly attached rows plus
 * rows attached to descendants ("프로젝트 A의 사람들 = 홍길동(직접) + 김또깡(↳ A.b)").
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
    return <p className="text-sm text-slate-400">관련 인원이 아직 없습니다.</p>;
  }
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {roster.map((r) => (
        <li key={r.assignmentId} className="flex items-center gap-2 py-1.5">
          <span className="w-10 shrink-0 text-xs font-semibold text-slate-500">
            {KIND_LABEL[r.kind] ?? r.kind}
          </span>
          <span className="font-medium text-slate-800">{r.contact.name}</span>
          {r.contact.department ? (
            <span className="text-slate-400">{r.contact.department}</span>
          ) : null}
          <span
            className={`ml-auto text-xs ${r.direct ? "text-slate-400" : "text-blue-500"}`}
          >
            {r.via}
          </span>
        </li>
      ))}
    </ul>
  );
}
