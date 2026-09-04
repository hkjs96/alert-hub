import { ToneLabel, btnSmall, btnSmallInk, overline } from "@/components/auth/primitives";
import { PendingButton } from "@/components/pending-button";
import { confirmVerificationCode, sendVerificationCode } from "@/server/auth-actions";
import { updateMyProfile } from "@/server/me-actions";
import type { CurrentUser } from "@/server/auth";
import { channelState, type VerifyState } from "@/lib/auth/verify";

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

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface ChannelConfig {
  slack: boolean;
  email: boolean;
}

/**
 * 프로필 + 통지 채널 카드 (A3 본문). /welcome 1단계와 /me 가 같이 쓴다.
 *
 * 채널은 세 상태다: 미등록 → 확인 필요(값은 있지만 도달 확인 전) → 확인됨.
 * "확인됨"은 실제로 코드를 보내 받은 사람이 입력했을 때만 붙는다. 서버에
 * 그 채널이 설정돼 있지 않으면 버튼을 "서버 미설정"으로 잠가 헛클릭을 막는다.
 */
export function ProfileCard({
  me,
  back,
  verify,
  configured,
  heading,
  intro,
}: {
  me: CurrentUser;
  back: string;
  /** `?verify=slack:sent|ok|bad|skipped|missing` */
  verify?: string;
  configured: ChannelConfig;
  heading: React.ReactNode;
  intro: React.ReactNode;
}) {
  const [vChannel, vResult] = (verify ?? "").split(":");
  const rows: {
    key: "slack" | "email" | "sms";
    name: string;
    state: VerifyState;
    verifiedAt: Date | null;
    detail: string;
    field?: "slackId" | "phone";
    placeholder?: string;
    hint?: string;
    serverOk: boolean;
  }[] = [
    {
      key: "slack",
      name: "Slack DM",
      state: channelState(me.slackId, me.slackVerifiedAt),
      verifiedAt: me.slackVerifiedAt,
      detail: me.slackId ? `@${me.slackId}` : "Slack 프로필 → ⋯ → 멤버 ID 복사 (U로 시작)",
      field: "slackId",
      placeholder: "U0123ABC",
      serverOk: configured.slack,
    },
    {
      key: "email",
      name: "이메일",
      state: channelState(me.email, me.emailVerifiedAt),
      verifiedAt: me.emailVerifiedAt,
      detail: me.email,
      serverOk: configured.email,
    },
    {
      key: "sms",
      name: "SMS",
      state: me.phone ? "unverified" : "unregistered",
      verifiedAt: null,
      detail: me.phone ?? "에스컬레이션에만 사용됩니다",
      field: "phone",
      placeholder: "+8210…",
      hint: "E.164 형식",
      serverOk: false,
    },
  ];
  const verified = rows.filter((r) => r.state === "verified").length;

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
        <span className={`font-mono text-[10px] font-bold tracking-[0.08em] ${verified ? "text-stone-400" : "text-[#b42318]"}`}>
          확인된 채널 {verified}개{verified ? "" : " · 1개 이상 필요"}
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-px">
        {rows.map((c) => {
          const on = c.state !== "unregistered";
          const mine = vChannel === c.key;
          return (
            <div
              key={c.key}
              className={`flex items-start gap-3 border px-4 py-3.5 ${c.state === "verified" ? "border-stone-200 bg-white" : "border-[#eeebe4] bg-stone-50"}`}
            >
              <span
                className={`mt-0.5 inline-block h-4 w-4 shrink-0 border ${
                  c.state === "verified"
                    ? "border-stone-900 bg-stone-900 shadow-[inset_0_0_0_3px_#1b1a17]"
                    : c.state === "unverified"
                      ? "border-stone-900 bg-white"
                      : "border-[#c9c4b8] bg-white"
                }`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-[13px] ${on ? "font-semibold text-stone-900" : "font-medium text-stone-500"}`}>{c.name}</span>
                  {c.state === "verified" ? (
                    <ToneLabel tone="ok">확인됨{c.verifiedAt ? ` ${fmt(c.verifiedAt)}` : ""}</ToneLabel>
                  ) : c.state === "unverified" ? (
                    <ToneLabel tone="warn">{c.key === "sms" ? "등록됨" : "확인 필요"}</ToneLabel>
                  ) : (
                    <ToneLabel tone="off">미등록</ToneLabel>
                  )}
                  {mine && vResult === "sent" ? <span className="text-xs text-[#067647]">코드를 보냈습니다 · 10분 안에 입력</span> : null}
                  {mine && vResult === "ok" ? <span className="text-xs text-[#067647]">확인 완료</span> : null}
                  {mine && vResult === "bad" ? <span className="text-xs text-[#b42318]">코드가 틀렸거나 만료되었습니다</span> : null}
                  {mine && vResult === "skipped" ? <span className="text-xs text-stone-500">서버에 이 채널이 설정돼 있지 않아 보내지 못했습니다</span> : null}
                </div>
                <div className="mt-0.5 truncate text-xs text-stone-400">{c.detail}</div>
                {c.field ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer list-none text-xs font-medium text-indigo-600 hover:underline [&::-webkit-details-marker]:hidden">
                      {on ? "변경" : c.key === "sms" ? "번호 등록" : "ID 등록"}
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
                {mine && vResult === "sent" ? (
                  <form action={confirmVerificationCode} className="mt-2 flex items-center gap-2">
                    <input type="hidden" name="channel" value={c.key} />
                    <input type="hidden" name="back" value={back} />
                    <input
                      name="code"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      autoFocus
                      placeholder="6자리 코드"
                      className="h-8 w-32 border border-stone-900 bg-white px-2.5 font-mono text-sm tracking-[0.2em] focus:outline-none"
                    />
                    <PendingButton pendingLabel="확인 중…" className={btnSmallInk}>
                      확인
                    </PendingButton>
                  </form>
                ) : null}
              </div>
              {c.key !== "sms" ? (
                on ? (
                  c.serverOk ? (
                    <form action={sendVerificationCode}>
                      <input type="hidden" name="channel" value={c.key} />
                      <input type="hidden" name="back" value={back} />
                      <PendingButton pendingLabel="보내는 중…" className={c.state === "verified" ? btnSmall : btnSmallInk}>
                        {c.state === "verified" ? "재확인" : "확인 코드 보내기"}
                      </PendingButton>
                    </form>
                  ) : (
                    <span
                      className="inline-flex h-[30px] items-center border border-[#e6e2d9] bg-[#f4f1ea] px-[13px] text-xs font-medium text-[#b0aca2]"
                      title={c.key === "slack" ? "SLACK_BOT_TOKEN 또는 SLACK_WEBHOOK_URL 이 설정되지 않았습니다" : "SMTP_HOST / SMTP_FROM 이 설정되지 않았습니다"}
                    >
                      서버 미설정
                    </span>
                  )
                ) : null
              ) : null}
            </div>
          );
        })}
      </div>
      {!configured.slack && !configured.email ? (
        <p className="mt-3 text-xs text-stone-400">
          서버에 통지 채널이 하나도 설정돼 있지 않습니다. 관리자가 Slack 웹훅이나 SMTP를 연결하면 여기서 확인할 수 있습니다.
        </p>
      ) : null}
    </div>
  );
}
