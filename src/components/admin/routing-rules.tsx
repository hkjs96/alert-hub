import { prisma } from "@/lib/prisma";
import { describeConditions } from "@/lib/routing";
import { getTeamChoices } from "@/server/org";
import { createRoutingRule, deleteRoutingRule, toggleRoutingRule } from "@/server/org-actions";
import { PendingButton } from "@/components/pending-button";

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";
const overline = "font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400";

/**
 * 고객사 패널의 "라우팅 규칙" 섹션. 트리(프로젝트 → 서비스) 순서 대신 알람
 * 속성으로 팀을 고르는 고객사를 위한 것 — "AWS/RDS는 DB팀", "CRITICAL은 야간
 * 당직". 우선순위 오름차순 첫 매치가 이기고, 매치가 없으면 트리 순서.
 */
export async function RoutingRulesEditor({ customerId, back }: { customerId: string; back: string }) {
  const [rules, teams, services] = await Promise.all([
    prisma.routingRule.findMany({
      where: { customerId },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      include: {
        team: { select: { name: true, customerId: true, _count: { select: { members: true } } } },
        service: { select: { name: true, project: { select: { name: true } } } },
      },
    }),
    getTeamChoices(customerId),
    prisma.service.findMany({
      where: { project: { customerId } },
      orderBy: [{ project: { name: "asc" } }, { name: "asc" }],
      include: { project: { select: { name: true } } },
    }),
  ]);

  return (
    <section className="border border-stone-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-200 px-5 py-3">
        <h2 className={overline}>라우팅 규칙</h2>
        <span className="text-xs text-stone-400">
          알람 속성(네임스페이스·메트릭·심각도·리소스)으로 팀을 고릅니다 · 우선순위 낮은 순 첫 매치 · 없으면 트리 순서
        </span>
      </div>

      {rules.length === 0 ? (
        <p className="px-5 py-3 text-xs text-stone-400">
          규칙이 없습니다 — 모든 알람이 조직 트리의 순서를 따릅니다. 인프라팀·DB팀처럼 기능 단위로 온콜을
          돌면 여기서 “AWS/RDS → DB팀” 같은 규칙을 만드세요.
        </p>
      ) : (
        <ol className="divide-y divide-stone-100">
          {rules.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm ${r.enabled ? "" : "opacity-50"}`}>
              <span className="w-8 font-mono text-[11px] text-stone-400">{r.priority}</span>
              <span className="font-medium text-stone-900">{r.name}</span>
              <span className="font-mono text-xs text-stone-500">{describeConditions(r)}</span>
              {r.service ? (
                <span className="text-xs text-stone-400">
                  {r.service.project.name} › {r.service.name} 한정
                </span>
              ) : null}
              <span className="text-stone-300">→</span>
              <span className="inline-flex h-[22px] items-center gap-1 border border-stone-900 bg-stone-900 px-2 text-xs font-medium text-white">
                <span className="font-mono text-[11px] opacity-70">팀</span>
                {r.team.name}
                <span className="opacity-60">· {r.team._count.members}명</span>
              </span>
              {r.team._count.members === 0 ? (
                <span className="text-xs text-[#b42318]">멤버 없음 — 매치돼도 트리 순서 유지</span>
              ) : null}
              <span className="ml-auto flex items-center gap-2">
                <form action={toggleRoutingRule}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="back" value={back} />
                  <button type="submit" className="text-xs text-stone-500 underline hover:text-stone-900">
                    {r.enabled ? "끄기" : "켜기"}
                  </button>
                </form>
                <form action={deleteRoutingRule}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="back" value={back} />
                  <button type="submit" className="text-xs text-stone-400 hover:text-[#b42318]">
                    삭제
                  </button>
                </form>
              </span>
            </li>
          ))}
        </ol>
      )}

      {teams.length === 0 ? (
        <p className="border-t border-stone-100 px-5 py-3 text-xs text-stone-400">
          규칙을 만들려면 먼저 팀이 필요합니다 (위 “이 고객사의 팀” 또는 팀 · 내부 인원).
        </p>
      ) : (
        <form action={createRoutingRule} className="flex flex-wrap items-end gap-2 border-t border-stone-100 px-5 py-3 text-sm">
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="back" value={back} />
          <label className="block w-36">
            <span className={`mb-1 block ${overline}`}>규칙 이름</span>
            <input name="name" required placeholder="RDS → DB팀" className={`${control} w-full`} />
          </label>
          <label className="block w-28">
            <span className={`mb-1 block ${overline}`}>namespace</span>
            <input name="namespace" placeholder="AWS/RDS" className={`${control} w-full font-mono`} />
          </label>
          <label className="block w-28">
            <span className={`mb-1 block ${overline}`}>metric</span>
            <input name="metric" placeholder="CPU*" className={`${control} w-full font-mono`} />
          </label>
          <label className="block w-28">
            <span className={`mb-1 block ${overline}`}>severity</span>
            <input name="severity" placeholder="CRITICAL,SEV-1" className={`${control} w-full font-mono`} />
          </label>
          <label className="block w-28">
            <span className={`mb-1 block ${overline}`}>resource</span>
            <input name="resource" placeholder="prod-*" className={`${control} w-full font-mono`} />
          </label>
          <label className="block w-40">
            <span className={`mb-1 block ${overline}`}>서비스 한정 (선택)</span>
            <select name="serviceId" defaultValue="" className={`${control} w-full`}>
              <option value="">전체</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.project.name} › {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block w-16">
            <span className={`mb-1 block ${overline}`}>우선</span>
            <input name="priority" type="number" defaultValue={100} className={`${control} w-full font-mono`} />
          </label>
          <label className="block w-40">
            <span className={`mb-1 block ${overline}`}>→ 팀</span>
            <select name="teamId" required defaultValue="" className={`${control} w-full`}>
              <option value="" disabled>
                팀 선택…
              </option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t._count.members}명){t.customerId === null ? " · 내부" : ""}
                </option>
              ))}
            </select>
          </label>
          <PendingButton
            pendingLabel="추가 중…"
            className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700"
          >
            + 규칙
          </PendingButton>
          <span className="basis-full text-xs text-stone-400">
            비운 조건은 와일드카드. 패턴은 <code className="font-mono">*</code> 글롭(대소문자 무시), severity는 쉼표 목록.
          </span>
        </form>
      )}
    </section>
  );
}
