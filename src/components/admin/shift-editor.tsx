import { prisma } from "@/lib/prisma";
import {
  addShiftMember,
  createOverride,
  createShift,
  deleteOverride,
  deleteShift,
  moveShiftMember,
  removeShiftMember,
  setTeamTimezone,
  toggleShift,
} from "@/server/oncall-actions";
import { resolveTeamOrders } from "@/server/oncall";
import {
  describeShift,
  formatZoned,
  parseWeekdays,
  toZonedInput,
  TIMEZONE_CHOICES,
  WEEKDAY_LABELS,
} from "@/lib/oncall";
import { PendingButton } from "@/components/pending-button";

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";
const iconBtn =
  "inline-flex h-6 w-6 items-center justify-center rounded-md border border-stone-300 bg-white text-xs text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-35 disabled:hover:bg-white";
const ghostBtn =
  "inline-flex h-7 items-center rounded-md border border-stone-300 bg-white px-2 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50";
const primaryBtn =
  "inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700";
const overline = "font-mono text-[11px] uppercase tracking-[0.06em] text-stone-400";

/**
 * 팀의 시간대 온콜: 시프트(요일·시간 창별 순서)와 대체 근무(기간 덮어쓰기).
 * 맨 위에 "지금 당번"을 보여 줘서 설정이 실제로 어떻게 해석되는지 바로 확인한다.
 * 시프트가 하나도 없으면 접혀 있고 한 줄 안내만 보인다 — 개인 배정만 쓰는
 * 팀에 소음을 주지 않는다.
 */
export async function ShiftEditor({ teamId, back }: { teamId: string; back: string }) {
  const now = new Date();
  const [team, shifts, overrides, res] = await Promise.all([
    prisma.team.findUnique({ where: { id: teamId }, include: { customer: true } }),
    prisma.onCallShift.findMany({
      where: { teamId },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      include: {
        members: { orderBy: [{ order: "asc" }, { createdAt: "asc" }], include: { contact: true } },
      },
    }),
    prisma.onCallOverride.findMany({
      where: { teamId, endAt: { gt: now } },
      orderBy: { startAt: "asc" },
      include: { contact: true },
    }),
    resolveTeamOrders([teamId], now),
  ]);
  if (!team) return null;
  const choices = await prisma.contact.findMany({
    where: { active: true, OR: [{ customerId: null }, ...(team.customerId ? [{ customerId: team.customerId }] : [])] },
    orderBy: { name: "asc" },
  });
  const nameOf = new Map(choices.map((c) => [c.id, c.name]));
  const cur = res.get(teamId);
  const tz = team.timezone;
  const hasAny = shifts.length > 0 || overrides.length > 0;

  const nowLine = cur ? (
    <p className="text-sm text-stone-700">
      <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-stone-400">지금 당번</span>{" "}
      {cur.order.length === 0 ? (
        <span className="text-stone-400">없음 — 활성 멤버가 없습니다</span>
      ) : (
        <>
          <span className="font-medium text-stone-900">{nameOf.get(cur.order[0]) ?? cur.order[0]}</span>
          {cur.order.length > 1 ? (
            <span className="text-stone-400"> → {cur.order.slice(1).map((id) => nameOf.get(id) ?? id).join(" → ")}</span>
          ) : null}
          <span className="ml-2 border border-stone-200 px-1 font-mono text-[11px] text-stone-500">
            {cur.source.kind === "default"
              ? "팀 기본 순서"
              : cur.source.kind === "shift"
                ? `시프트 · ${cur.source.name}`
                : `대체 근무${cur.source.note ? ` · ${cur.source.note}` : ""}`}
          </span>
          <span className="ml-1 text-xs text-stone-400">{formatZoned(now, tz)} {tz}</span>
        </>
      )}
    </p>
  ) : null;

  return (
    <details className="border-t border-dashed border-stone-200 pt-2" open={hasAny}>
      <summary className="cursor-pointer select-none text-xs text-stone-500 hover:text-stone-800">
        <span className="font-medium">시간대 온콜</span>{" "}
        <span className="text-stone-400">
          {hasAny
            ? `시프트 ${shifts.length}개 · 대체 근무 ${overrides.length}건`
            : "시프트 없음 — 하루 종일 위 순서 그대로. 주간·야간·주말이 다르면 여기서 나누세요"}
        </span>
      </summary>

      <div className="mt-2 space-y-3">
        {nowLine}

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={overline}>시프트</span>
            <span className="text-xs text-stone-400">
              창 안에서는 시프트 순서가 앞에 오고 팀 기본 순서가 뒤에 이어집니다. 겹치면 아래쪽(나중에 만든) 시프트가 이깁니다.
            </span>
          </div>
          {shifts.map((s) => {
            const inShift = new Set(s.members.map((m) => m.contactId));
            const avail = choices.filter((c) => !inShift.has(c.id));
            return (
              <div key={s.id} className={`border border-stone-200 bg-white p-2 ${s.enabled ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-stone-900">{s.name}</span>
                  <span className="font-mono text-xs text-stone-500">
                    {describeShift({ weekdays: parseWeekdays(s.weekdays), startMin: s.startMin, endMin: s.endMin })}
                  </span>
                  {!s.enabled ? (
                    <span className="border border-stone-200 px-1 font-mono text-[11px] text-stone-400">꺼짐</span>
                  ) : null}
                  <span className="ml-auto flex items-center gap-1">
                    <form action={toggleShift} className="inline">
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="back" value={back} />
                      <button className={ghostBtn}>{s.enabled ? "끄기" : "켜기"}</button>
                    </form>
                    <form action={deleteShift} className="inline">
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="back" value={back} />
                      <button aria-label={`${s.name} 시프트 삭제`} className="px-1 text-stone-400 hover:text-[#b42318]">×</button>
                    </form>
                  </span>
                </div>
                <ol className="mt-1.5 space-y-1">
                  {s.members.length === 0 ? (
                    <li className="text-xs text-stone-400">당번이 없습니다 — 비어 있는 시프트는 건너뛰고 팀 기본 순서로 갑니다.</li>
                  ) : null}
                  {s.members.map((m, i) => (
                    <li key={m.id} className="flex items-center gap-2 bg-stone-50 px-2 py-1 text-sm">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center bg-stone-900 font-mono text-[11px] font-bold text-white">
                        {i + 1}
                      </span>
                      <span className={m.contact.active ? "text-stone-900" : "text-stone-400 line-through"}>{m.contact.name}</span>
                      <span className="ml-auto flex items-center gap-1">
                        <form action={moveShiftMember} className="inline">
                          <input type="hidden" name="id" value={m.id} />
                          <input type="hidden" name="direction" value="up" />
                          <input type="hidden" name="back" value={back} />
                          <button aria-label={`${m.contact.name} 올리기`} disabled={i === 0} className={iconBtn}>↑</button>
                        </form>
                        <form action={moveShiftMember} className="inline">
                          <input type="hidden" name="id" value={m.id} />
                          <input type="hidden" name="direction" value="down" />
                          <input type="hidden" name="back" value={back} />
                          <button aria-label={`${m.contact.name} 내리기`} disabled={i === s.members.length - 1} className={iconBtn}>↓</button>
                        </form>
                        <form action={removeShiftMember} className="inline">
                          <input type="hidden" name="id" value={m.id} />
                          <input type="hidden" name="back" value={back} />
                          <button aria-label={`${m.contact.name} 시프트에서 제외`} className="px-1 text-stone-400 hover:text-[#b42318]">×</button>
                        </form>
                      </span>
                    </li>
                  ))}
                </ol>
                {avail.length > 0 ? (
                  <form action={addShiftMember} className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
                    <input type="hidden" name="shiftId" value={s.id} />
                    <input type="hidden" name="back" value={back} />
                    <select name="contactId" required defaultValue="" aria-label={`${s.name} 당번 추가`} className={control}>
                      <option value="" disabled>당번 추가 (맨 뒤 순번으로)…</option>
                      {avail.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}{c.department ? ` (${c.department})` : ""}</option>
                      ))}
                    </select>
                    <PendingButton pendingLabel="추가 중…" className={ghostBtn}>+ 당번</PendingButton>
                  </form>
                ) : null}
              </div>
            );
          })}

          <form action={createShift} className="flex flex-wrap items-center gap-1.5 border border-dashed border-stone-300 p-2 text-sm">
            <input type="hidden" name="teamId" value={teamId} />
            <input type="hidden" name="back" value={back} />
            <input name="name" required placeholder="시프트 이름 (예: 야간)" aria-label="시프트 이름" className={`${control} w-36`} />
            <fieldset className="flex items-center gap-1" aria-label="요일">
              {WEEKDAY_LABELS.map((l, i) => (
                <label key={i} className="inline-flex cursor-pointer items-center gap-0.5 text-xs text-stone-600">
                  <input type="checkbox" name="weekday" value={i} defaultChecked={i >= 1 && i <= 5} className="accent-stone-900" />
                  {l}
                </label>
              ))}
            </fieldset>
            <input type="time" name="start" required defaultValue="18:00" aria-label="시작" className={`${control} w-28`} />
            <span className="text-stone-400">→</span>
            <input type="time" name="end" required defaultValue="09:00" aria-label="끝" className={`${control} w-28`} />
            <PendingButton pendingLabel="만드는 중…" className={primaryBtn}>+ 시프트</PendingButton>
            <span className="basis-full text-xs text-stone-400">끝이 시작보다 빠르면 자정을 넘는 창입니다. 시각은 {tz} 기준.</span>
          </form>
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={overline}>대체 근무</span>
            <span className="text-xs text-stone-400">휴가·교대 스왑. 기간 동안 이 사람이 1순위가 되고 나머지가 뒤에 이어집니다.</span>
          </div>
          {overrides.length > 0 ? (
            <ul className="divide-y divide-stone-100 border border-stone-200 bg-white text-sm">
              {overrides.map((o) => {
                const active = o.startAt <= now && now < o.endAt;
                return (
                  <li key={o.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                    <span className={`font-medium ${active ? "text-stone-900" : "text-stone-600"}`}>{o.contact.name}</span>
                    <span className="font-mono text-xs text-stone-500">
                      {formatZoned(o.startAt, tz)} → {formatZoned(o.endAt, tz)}
                    </span>
                    {active ? <span className="border border-stone-900 px-1 font-mono text-[11px] text-stone-900">진행 중</span> : <span className="border border-stone-200 px-1 font-mono text-[11px] text-stone-400">예정</span>}
                    {o.note ? <span className="text-xs text-stone-400">{o.note}</span> : null}
                    <form action={deleteOverride} className="ml-auto inline">
                      <input type="hidden" name="id" value={o.id} />
                      <input type="hidden" name="back" value={back} />
                      <button aria-label="대체 근무 삭제" className="px-1 text-stone-400 hover:text-[#b42318]">×</button>
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <form action={createOverride} className="flex flex-wrap items-center gap-1.5 border border-dashed border-stone-300 p-2 text-sm">
            <input type="hidden" name="teamId" value={teamId} />
            <input type="hidden" name="back" value={back} />
            <select name="contactId" required defaultValue="" aria-label="대체 근무자" className={control}>
              <option value="" disabled>대체 근무자…</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.department ? ` (${c.department})` : ""}</option>
              ))}
            </select>
            <input type="datetime-local" name="start" required defaultValue={toZonedInput(now, tz)} aria-label="시작" className={`${control} w-48`} />
            <span className="text-stone-400">→</span>
            <input type="datetime-local" name="end" required defaultValue={toZonedInput(new Date(now.getTime() + 24 * 3600 * 1000), tz)} aria-label="끝" className={`${control} w-48`} />
            <input name="note" placeholder="메모 (예: 박지훈 휴가)" aria-label="메모" className={`${control} w-44`} />
            <PendingButton pendingLabel="등록 중…" className={primaryBtn}>+ 대체 근무</PendingButton>
          </form>
        </div>

        <form action={setTeamTimezone} className="flex flex-wrap items-center gap-1.5 text-sm">
          <input type="hidden" name="id" value={teamId} />
          <input type="hidden" name="back" value={back} />
          <span className={overline}>시간대</span>
          <select name="timezone" defaultValue={tz} aria-label="팀 시간대" className={control}>
            {TIMEZONE_CHOICES.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
          <PendingButton pendingLabel="저장 중…" className={ghostBtn}>저장</PendingButton>
          <span className="text-xs text-stone-400">시프트 창과 대체 근무 기간을 이 시간대로 해석합니다.</span>
        </form>
      </div>
    </details>
  );
}
