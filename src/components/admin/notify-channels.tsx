import { getScopeChannels } from "@/server/notify-targets";
import { describeTarget } from "@/lib/notify/targets";
import { isBotConfigured, defaultBotChannel } from "@/lib/notify/slack-api";
import { createNotifyChannel, deleteNotifyChannel, testNotifyChannel, toggleNotifyChannel } from "@/server/channel-actions";
import { PendingButton } from "@/components/pending-button";
import { ToneLabel } from "@/components/auth/primitives";

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";
const overline = "font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400";

function fmt(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ") + "Z";
}

/**
 * 스코프의 Slack 통지 채널 (고객사/프로젝트/서비스). 담당자 배정과 같은 상속:
 * 여기 채널이 하나라도 있으면 그 목록이 통째로, 없으면 상위 채널이 적용된다.
 * 종류 둘 — 우리 워크스페이스 채널(봇)과 고객사가 발급해 준 외부 웹훅.
 */
export async function NotifyChannelsEditor({
  level,
  ids,
  back,
}: {
  level: "customer" | "project" | "service";
  ids: { customerId: string; projectId?: string; serviceId?: string };
  back: string;
}) {
  const { direct, inherited } = await getScopeChannels(level, ids);
  const scopeId = level === "service" ? ids.serviceId! : level === "project" ? ids.projectId! : ids.customerId;
  const bot = isBotConfigured();
  const fallback = bot && defaultBotChannel() ? `전사 기본 ${defaultBotChannel()}` : process.env.SLACK_WEBHOOK_URL ? "전사 웹훅" : null;
  const levelLabel = { customer: "고객사", project: "프로젝트", service: "서비스" }[level];

  return (
    <div className="space-y-2">
      {direct.length === 0 ? (
        <p className="text-sm text-stone-400">
          이 {levelLabel}에 직접 지정된 채널 없음 —{" "}
          {inherited.length ? (
            <>
              상위 채널 상속:{" "}
              <span className="text-stone-600">
                {inherited.map((t) => `${t.label ?? t.target} (${t.level === "project" ? "프로젝트" : "고객사"})`).join(", ")}
              </span>
            </>
          ) : fallback ? (
            <>
              <span className="text-stone-600">{fallback}</span>으로 갑니다
            </>
          ) : (
            <span className="text-[#b42318]">보낼 곳이 없습니다 (전사 기본도 미설정)</span>
          )}
        </p>
      ) : (
        <ul className="divide-y divide-stone-100 border border-stone-200 bg-white">
          {direct.map((c) => (
            <li key={c.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${c.enabled ? "" : "opacity-50"}`}>
              <span className="border border-stone-200 px-1 font-mono text-[11px] text-stone-500">
                {c.kind === "SLACK_BOT" ? "봇" : "웹훅"}
              </span>
              <span className="font-medium text-stone-900">{c.label}</span>
              <span className="font-mono text-xs text-stone-500">{describeTarget(c)}</span>
              {c.lastError ? (
                <ToneLabel tone="err">실패</ToneLabel>
              ) : c.lastOkAt ? (
                <ToneLabel tone="ok">확인 {fmt(c.lastOkAt)}</ToneLabel>
              ) : (
                <ToneLabel tone="off">미확인</ToneLabel>
              )}
              {c.lastError ? <span className="text-xs text-[#b42318]" title={c.lastError}>{c.lastError.slice(0, 60)}</span> : null}
              <span className="ml-auto flex items-center gap-1.5">
                <form action={testNotifyChannel}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="back" value={back} />
                  <PendingButton pendingLabel="발송 중…" className="inline-flex h-7 items-center border border-stone-900 bg-white px-2.5 text-xs font-semibold text-stone-900 hover:bg-stone-50">
                    테스트 메시지
                  </PendingButton>
                </form>
                <form action={toggleNotifyChannel}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="back" value={back} />
                  <button type="submit" className="text-xs text-stone-500 underline hover:text-stone-900">
                    {c.enabled ? "끄기" : "켜기"}
                  </button>
                </form>
                <form action={deleteNotifyChannel}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="back" value={back} />
                  <button type="submit" className="text-xs text-stone-400 hover:text-[#b42318]">
                    삭제
                  </button>
                </form>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form action={createNotifyChannel} className="flex flex-wrap items-end gap-2 text-sm">
        <input type="hidden" name="level" value={level} />
        <input type="hidden" name="scopeId" value={scopeId} />
        <input type="hidden" name="back" value={back} />
        <label className="block w-36">
          <span className={`mb-1 block ${overline}`}>종류</span>
          <select name="kind" defaultValue={bot ? "SLACK_BOT" : "SLACK_WEBHOOK"} className={`${control} w-full`}>
            <option value="SLACK_BOT" disabled={!bot}>
              우리 Slack 채널{bot ? "" : " (봇 미설정)"}
            </option>
            <option value="SLACK_WEBHOOK">고객사 웹훅 URL</option>
          </select>
        </label>
        <label className="block w-40">
          <span className={`mb-1 block ${overline}`}>이름</span>
          <input name="label" required placeholder="홈닉 공유 채널" className={`${control} w-full`} />
        </label>
        <label className="block w-72">
          <span className={`mb-1 block ${overline}`}>채널 ID · #이름 · 웹훅 URL</span>
          <input name="target" required placeholder="#homenic-alerts 또는 https://hooks.slack.com/services/…" className={`${control} w-full font-mono text-xs`} />
        </label>
        <PendingButton pendingLabel="추가 중…" className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white hover:bg-stone-700">
          + 채널
        </PendingButton>
        <span className="basis-full text-xs text-stone-400">
          봇 채널은 비공개 채널이면 <code className="font-mono">/invite @alert-hub</code> 가 필요합니다. 여러 개를 두면 모두에게 보냅니다(예: 고객사 공유 채널 + 내부 온콜).
        </span>
      </form>
    </div>
  );
}
