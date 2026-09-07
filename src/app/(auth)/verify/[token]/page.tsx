import Link from "next/link";
import { ToneLabel } from "@/components/auth/primitives";
import { consumeVerificationLink } from "@/server/verify-actions";

export const dynamic = "force-dynamic";

const LABEL = { slack: "Slack", email: "이메일", sms: "문자" } as const;

/**
 * 확인 링크 착지 (로그인 불필요, 앱 셸 없음). 관리자가 보낸 링크를 받은 사람이
 * 열면 그 채널이 확인됨으로 기록된다. 성공 / 이미 확인됨 / 만료·무효.
 */
export default async function VerifyLinkPage({ params }: { params: { token: string } }) {
  const r = await consumeVerificationLink(params.token);
  return (
    <div className="w-[480px] max-w-full">
      <div
        className="border border-stone-200 bg-white px-[34px] py-8"
        style={{ borderLeft: `3px solid ${r.ok ? "#067647" : "#b54708"}` }}
      >
        {r.ok ? (
          <>
            <ToneLabel tone="ok">{r.already ? "이미 확인됨" : "확인 완료"}</ToneLabel>
            <h1 className="mt-3.5 text-[20px] font-semibold leading-snug tracking-[-0.02em] text-stone-900">
              {LABEL[r.channel]} 채널이 확인되었습니다
            </h1>
            <p className="mt-2.5 text-[13px] leading-[1.65] text-[#4a4842]">
              {r.name}님, 이제 담당 알람이 발화하면 이 {LABEL[r.channel]}로 통지가 갑니다. 이 창은 닫으셔도 됩니다.
            </p>
          </>
        ) : (
          <>
            <ToneLabel tone="warn">{r.reason === "expired" ? "만료됨" : "유효하지 않음"}</ToneLabel>
            <h1 className="mt-3.5 text-[20px] font-semibold leading-snug tracking-[-0.02em] text-stone-900">
              {r.reason === "expired" ? "링크가 만료되었습니다" : "링크를 확인할 수 없습니다"}
            </h1>
            <p className="mt-2.5 text-[13px] leading-[1.65] text-[#4a4842]">
              {r.reason === "expired"
                ? "확인 링크는 24시간 동안만 유효합니다. 담당 관리자에게 다시 요청해 달라고 말씀해 주세요."
                : "링크가 잘못됐거나 이미 다른 방법으로 처리되었습니다. 담당 관리자에게 문의해 주세요."}
            </p>
          </>
        )}
        <div className="mt-6 text-xs text-stone-400">
          <Link href="/" className="text-indigo-600 hover:underline">
            alert-hub
          </Link>{" "}
          · 사내 운영 도구
        </div>
      </div>
    </div>
  );
}
