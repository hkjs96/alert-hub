import { ToneLabel, btnSmall, btnSmallInk, overline } from "@/components/auth/primitives";
import { PendingButton } from "@/components/pending-button";
import { sendTestNotification } from "@/server/auth-actions";
import { updateMyProfile } from "@/server/me-actions";
import type { CurrentUser } from "@/server/auth";

const control =
  "h-[38px] w-full border border-stone-200 bg-white px-3 text-[13px] text-stone-900 transition-colors hover:border-stone-400 focus:border-stone-900 focus:outline-none";

export const TIMEZONES = ["Asia/Seoul", "UTC", "Asia/Tokyo", "Asia/Singapore", "America/Los_Angeles", "America/New_York", "Europe/London"];

function tzLabel(tz: string): string {
  try {
    const off = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    return off ? `${tz} (${off})` : tz;
  } catch {
    return tz;
  }
}

function testNote(test: string | undefined, channel: string): React.ReactNode {
  if (!test || !test.startsWith(channel + ":")) return null;
  const r = test.split(":")[1];
  if (r === "sent") return <span className="text-xs text-[#067647]">테스트 발송됨</span>;
  if (r === "skipped") return <span className="text-xs text-stone-500">채널이 서버에 설정돼 있지 않습니다</span>;
  return <span className="text-xs text-stone-500">먼저 등록하세요</span>;
}

/**
 * 프로필 + 통지 채널 카드 (A3 본문). /welcome 1단계와 /me 가 같이 쓴다.
 * 채널 행은 `<details>` 로 편집을 펼친다 — JS 없이 동작.
 */
export function ProfileCard({
  me,
  back,
  test,
  heading,
  intro,
}: {
  me: CurrentUser;
  back: string;
  test?: string;
  heading: React.ReactNode;
  intro: React.ReactNode;
}) {
  const channels: {
    key: "slack" | "email" | "sms";
    name: string;
    on: boolean;
    detail: string;
    field?: "slackId" | "phone";
    placeholder?: string;
    hint?: string;
  }[] = [
    {
      key: "slack",
      name: "Slack DM",
      on: Boolean(me.slackId),
      detail: me.slackId ? `@${me.slackId}` : "Slack 프로필 → ⋯ → 멤버 ID 복사 (U로 시작)",
      field: "slackId",
      placeholder: "U0123ABC",
    },
    { key: "email", name: "이메일", on: Boolean(me.email), detail: me.email },
    {
      key: "sms",
      name: "SMS",
      on: Boolean(me.phone),
      detail: me.phone ?? "에스컬레이션에만 사용됩니다",
      field: "phone",
      placeholder: "+8210…",
      hint: "E.164 형식",
    },
  ];
  const connected = channels.filter((c) => c.on).length;

  return (
    <div className="border border-stone-200 bg-white px-[34px] py-8">
      <h1 className="text-[21px] font-semibold leading-tight tracking-[-0.025em] text-stone-900">{heading}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-stone-500">{intro}</p>

      <div className="my-[26px] h-px bg-[#eeebe4]" />

      <form action={updateMyProfile} className="grid grid-cols-2 gap-5">
        <input type="hidden" name="back" value={back} />
        <label className="block">
          <span className={`mb-2 block ${overline}`}>이름</span>
          <input name="name" defaultValue={me.name} required className={control} />
        </label>
        <div>
          <span className={`mb-2 block ${overline}`}>이메일</span>
          <div className="flex h-[38px] items-center justify-between border border-[#eeebe4] bg-stone-50 px-3">
            <span className="font-mono text-xs text-stone-500">{me.email}</span>
            <span className="font-mono text-[10px] tracking-[0.08em] text-stone-300">고정</span>
          </div>
        </div>
        <label className="block">
          <span className={`mb-2 block ${overline}`}>부서</span>
          <input name="department" defaultValue={me.department ?? ""} placeholder="SRE팀" className={control} />
        </label>
        <label className="block">
          <span className={`mb-2 block ${overline}`}>시간대</span>
          <select name="timezone" defaultValue={me.timezone ?? "Asia/Seoul"} className={control}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tzLabel(tz)}
              </option>
            ))}
          </select>
        </label>
        <div className="col-span-2 flex justify-end">
          <PendingButton pendingLabel="저장 중…" className={btnSmallInk}>
            프로필 저장
          </PendingButton>
        </div>
      </form>

      <div className="my-[26px] h-px bg-[#eeebe4]" />

      <div className="flex items-center gap-2">
        <span className={overline}>통지 채널</span>
        <span className={`font-mono text-[10px] font-bold tracking-[0.08em] ${connected ? "text-stone-400" : "text-[#b42318]"}`}>
          1개 이상 필수{connected ? ` · ${connected}개 연결` : ""}
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-px">
        {channels.map((c) => (
          <div
            key={c.key}
            className={`flex items-center gap-3 border px-4 py-3.5 ${c.on ? "border-stone-200 bg-white" : "border-[#eeebe4] bg-stone-50"}`}
          >
            <span
              className={`inline-block h-4 w-4 shrink-0 border ${c.on ? "border-stone-900 bg-stone-900 shadow-[inset_0_0_0_3px_#1b1a17]" : "border-[#c9c4b8] bg-white"}`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`text-[13px] ${c.on ? "font-semibold text-stone-900" : "font-medium text-stone-500"}`}>{c.name}</span>
                {c.on ? <ToneLabel tone="ok">연결됨</ToneLabel> : <ToneLabel tone="off">미연결</ToneLabel>}
                {testNote(test, c.key)}
              </div>
              <div className="mt-0.5 truncate text-xs text-stone-400">{c.detail}</div>
              {c.field ? (
                <details className="mt-2">
                  <summary className="cursor-pointer list-none text-xs font-medium text-indigo-600 hover:underline [&::-webkit-details-marker]:hidden">
                    {c.on ? "변경" : c.key === "sms" ? "번호 등록" : "ID 등록"}
                  </summary>
                  <form action={updateMyProfile} className="mt-2 flex items-center gap-2">
                    <input type="hidden" name="back" value={back} />
                    <input
                      name={c.field}
                      defaultValue={c.field === "slackId" ? (me.slackId ?? "") : (me.phone ?? "")}
                      placeholder={c.placeholder}
                      className="h-8 w-48 border border-stone-200 bg-white px-2.5 font-mono text-xs focus:border-stone-900 focus:outline-none"
                    />
                    <PendingButton pendingLabel="저장 중…" className={btnSmallInk}>
                      저장
                    </PendingButton>
                    {c.hint ? <span className="text-[11px] text-stone-400">{c.hint}</span> : null}
                  </form>
                </details>
              ) : null}
            </div>
            {c.key !== "sms" ? (
              <form action={sendTestNotification}>
                <input type="hidden" name="channel" value={c.key} />
                <input type="hidden" name="back" value={back} />
                <PendingButton pendingLabel="발송 중…" className={btnSmall} disabled={!c.on}>
                  테스트 발송
                </PendingButton>
              </form>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
