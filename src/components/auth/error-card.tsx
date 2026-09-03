import Link from "next/link";
import { RefLine, TONE, ToneLabel, btnPrimaryAccent, btnPrimaryInk, btnSecondary, type AuthTone } from "@/components/auth/primitives";

/**
 * 로그인 오류 카드 (A2). 사용자 언어로만 — 단계명(state·claims·exchange)은
 * 로그에 참조 코드와 함께 남고 화면에는 원인·다음 행동·참조 코드만 나온다.
 */
export interface AuthErrorSpec {
  tone: AuthTone;
  tag: string;
  title: string;
  body: string;
  primary: { label: string; href: string };
  secondary?: { label: string; href: string };
}

export const AUTH_ERRORS: Record<string, AuthErrorSpec> = {
  domain: {
    tone: "err",
    tag: "접근 불가",
    title: "회사 계정으로 로그인해 주세요",
    body: "이 Google 계정으로는 이 도구에 접근할 수 없습니다. 회사에서 발급한 계정으로 다시 시도해 주세요.",
    primary: { label: "다른 계정으로 로그인", href: "/api/auth/login" },
    secondary: { label: "지원 요청", href: "/login?help=1" },
  },
  customer: {
    tone: "err",
    tag: "접근 불가",
    title: "내부 인원 계정이 아닙니다",
    body: "이 이메일은 고객사 담당자로 등록돼 있습니다. 내부 인원만 로그인할 수 있으니 관리자에게 소속 변경을 요청해 주세요.",
    primary: { label: "다른 계정으로 로그인", href: "/api/auth/login" },
    secondary: { label: "지원 요청", href: "/login?help=1" },
  },
  inactive: {
    tone: "err",
    tag: "접근 불가",
    title: "비활성 처리된 계정입니다",
    body: "이 계정은 관리자가 비활성으로 두었습니다. 다시 사용해야 하면 관리자에게 활성화를 요청해 주세요.",
    primary: { label: "다른 계정으로 로그인", href: "/api/auth/login" },
    secondary: { label: "지원 요청", href: "/login?help=1" },
  },
  rejected: {
    tone: "err",
    tag: "접근 불가",
    title: "가입 요청이 거절되었습니다",
    body: "관리자가 이 계정의 접근 요청을 거절했습니다. 필요하다면 관리자에게 다시 검토를 요청해 주세요.",
    primary: { label: "다른 계정으로 로그인", href: "/api/auth/login" },
    secondary: { label: "지원 요청", href: "/login?help=1" },
  },
  state: {
    tone: "warn",
    tag: "중단됨",
    title: "로그인이 완료되지 않았습니다",
    body: "인증 창이 닫히거나 시간이 초과되었습니다. 다시 시도하면 대부분 해결됩니다.",
    primary: { label: "다시 시도", href: "/api/auth/login" },
    secondary: { label: "처음으로", href: "/login" },
  },
  denied: {
    tone: "warn",
    tag: "중단됨",
    title: "로그인이 취소되었습니다",
    body: "Google 로그인 창에서 취소되었습니다. 다시 시도해 주세요.",
    primary: { label: "다시 시도", href: "/api/auth/login" },
    secondary: { label: "처음으로", href: "/login" },
  },
  exchange: {
    tone: "info",
    tag: "일시 장애",
    title: "로그인 서비스에 연결할 수 없습니다",
    body: "인증 공급자 응답에 문제가 있습니다. 잠시 후 다시 시도해 주세요. 진행 중인 알람은 Slack으로 계속 전달됩니다.",
    primary: { label: "다시 시도", href: "/api/auth/login" },
    secondary: { label: "처음으로", href: "/login" },
  },
  claims: {
    tone: "info",
    tag: "일시 장애",
    title: "계정 정보를 확인할 수 없습니다",
    body: "인증 공급자가 돌려준 계정 정보가 올바르지 않습니다. 다시 시도해도 반복되면 참조 코드와 함께 문의해 주세요.",
    primary: { label: "다시 시도", href: "/api/auth/login" },
    secondary: { label: "처음으로", href: "/login" },
  },
};

export function AuthErrorCard({ code, refCode }: { code: string; refCode?: string }) {
  const e = AUTH_ERRORS[code] ?? AUTH_ERRORS.state;
  const t = TONE[e.tone];
  return (
    <div className="border border-stone-200 bg-white px-7 py-[26px]" style={{ borderLeft: `3px solid ${t.color}` }}>
      <ToneLabel tone={e.tone}>{e.tag}</ToneLabel>
      <div className="mt-3 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-stone-900">{e.title}</div>
      <p className="mt-2 text-[13px] leading-relaxed text-[#4a4842]">{e.body}</p>
      <div className="mt-5 flex gap-2">
        <Link href={e.primary.href} className={e.tone === "err" ? btnPrimaryInk : btnPrimaryAccent}>
          {e.primary.label}
        </Link>
        {e.secondary ? (
          <Link href={e.secondary.href} className={btnSecondary}>
            {e.secondary.label}
          </Link>
        ) : null}
      </div>
      {refCode ? <RefLine code={refCode} /> : null}
    </div>
  );
}
