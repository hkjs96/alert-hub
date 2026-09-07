import { ToneLabel } from "@/components/auth/primitives";
import { PendingButton } from "@/components/pending-button";
import { channelState, viaLabel, type VerifyChannel } from "@/lib/auth/verify";
import { emailNotifier } from "@/lib/notify/email";
import { isBotConfigured } from "@/lib/notify/slack-api";
import { isSmsConfigured } from "@/lib/notify/twilio";
import { manualVerifyChannel, requestChannelVerification } from "@/server/verify-actions";

const overline = "font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400";
const btn =
  "inline-flex h-7 items-center border border-stone-900 bg-white px-2.5 text-xs font-semibold text-stone-900 hover:bg-stone-50 disabled:cursor-not-allowed disabled:border-stone-200 disabled:text-stone-400";
const btnSec = "inline-flex h-7 items-center border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-600 hover:border-stone-400";

function fmt(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ") + "Z";
}

/**
 * 인원 행 안의 "통지 채널 확인" 블록 (관리자). 로그인하지 않는 고객사 담당자를
 * 위해 관리자가 확인 링크를 보내거나, 전화로 확인한 경우 수동 확인을 남긴다.
 */
export function ChannelVerifyPanel({
  c,
  back,
  vreq,
}: {
  c: {
    id: string;
    slackId: string | null;
    email: string | null;
    phone: string | null;
    slackVerifiedAt: Date | null;
    emailVerifiedAt: Date | null;
    phoneVerifiedAt: Date | null;
    slackVerifiedVia: string | null;
    emailVerifiedVia: string | null;
    phoneVerifiedVia: string | null;
    verifyNote: string | null;
    verifications: { channel: string; sentAt: Date; usedAt: Date | null; expiresAt: Date; requestedBy: string | null }[];
  };
  back: string;
  vreq?: string;
}) {
  const rows: { key: VerifyChannel; name: string; value: string | null; at: Date | null; via: string | null; serverOk: boolean; why: string }[] = [
    { key: "slack", name: "Slack DM", value: c.slackId, at: c.slackVerifiedAt, via: c.slackVerifiedVia, serverOk: isBotConfigured(), why: "봇 토큰 없음" },
    { key: "email", name: "이메일", value: c.email, at: c.emailVerifiedAt, via: c.emailVerifiedVia, serverOk: emailNotifier.isConfigured(), why: "SMTP 없음" },
    { key: "sms", name: "문자", value: c.phone, at: c.phoneVerifiedAt, via: c.phoneVerifiedVia, serverOk: isSmsConfigured(), why: "SMS 공급자 없음" },
  ];
  const [vChannel, vResult] = (vreq ?? "").split(":");
  const registered = rows.filter((r) => r.value);
  if (!registered.length) return null;

  return (
    <div>
      <div className={`mb-1.5 ${overline}`}>통지 채널 확인</div>
      <ul className="divide-y divide-stone-200 border border-stone-200 bg-white">
        {registered.map((r) => {
          const state = channelState(r.value, r.at);
          const pending = c.verifications.find((v) => v.channel === r.key && !v.usedAt && v.expiresAt.getTime() > Date.now());
          return (
            <li key={r.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="w-16 font-medium text-stone-900">{r.name}</span>
              <span className="font-mono text-xs text-stone-500">{r.value}</span>
              {state === "verified" ? (
                <ToneLabel tone="ok">
                  확인됨 {r.at ? fmt(r.at) : ""}
                  {r.via ? ` · ${viaLabel(r.via)}` : ""}
                </ToneLabel>
              ) : pending ? (
                <ToneLabel tone="info">요청됨 {fmt(pending.sentAt)}{pending.requestedBy ? ` · ${pending.requestedBy}` : ""}</ToneLabel>
              ) : (
                <ToneLabel tone="warn">확인 필요</ToneLabel>
              )}
              {vChannel === r.key ? (
                <span className={`text-xs ${vResult === "sent" || vResult === "manual" ? "text-[#067647]" : "text-stone-500"}`}>
                  {vResult === "sent"
                    ? "확인 링크를 보냈습니다"
                    : vResult === "manual"
                      ? "수동 확인 기록됨"
                      : vResult === "skipped"
                        ? "서버 발송 실패 또는 미설정"
                        : vResult === "noappurl"
                          ? "APP_URL 이 없어 링크를 만들 수 없습니다"
                          : ""}
                </span>
              ) : null}
              <span className="ml-auto flex items-center gap-1.5">
                <form action={requestChannelVerification}>
                  <input type="hidden" name="contactId" value={c.id} />
                  <input type="hidden" name="channel" value={r.key} />
                  <input type="hidden" name="back" value={back} />
                  <PendingButton pendingLabel="보내는 중…" className={btn} disabled={!r.serverOk} title={r.serverOk ? "24시간 유효한 확인 링크를 보냅니다" : r.why}>
                    {state === "verified" ? "재확인 요청" : pending ? "다시 보내기" : "확인 요청 보내기"}
                  </PendingButton>
                </form>
                {state !== "verified" ? (
                  <details className="relative">
                    <summary className={`${btnSec} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>수동 확인</summary>
                    <form action={manualVerifyChannel} className="absolute right-0 z-10 mt-1 flex w-72 flex-col gap-1.5 border border-stone-300 bg-white p-2.5 shadow-md">
                      <input type="hidden" name="contactId" value={c.id} />
                      <input type="hidden" name="channel" value={r.key} />
                      <input type="hidden" name="back" value={back} />
                      <span className="text-xs text-stone-500">전화 등으로 직접 확인한 경우에만. 이름과 시각이 남습니다.</span>
                      <input name="note" placeholder="메모 (예: 9/4 통화로 확인)" className="h-7 border border-stone-200 px-2 text-xs" />
                      <PendingButton pendingLabel="기록 중…" className={btn}>
                        확인됨으로 기록
                      </PendingButton>
                    </form>
                  </details>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {c.verifyNote ? <p className="mt-1 text-xs text-stone-400">메모: {c.verifyNote}</p> : null}
    </div>
  );
}
