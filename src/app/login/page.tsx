import Link from "next/link";
import { readAuthConfig } from "@/lib/auth/config";
import { safeNext } from "@/lib/auth/paths";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  disabled: "SSO가 설정되어 있지 않습니다. 관리자가 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / AUTH_SECRET 을 설정해야 합니다.",
  denied: "Google 로그인이 취소되었습니다.",
  state: "로그인 세션이 만료되었거나 일치하지 않습니다. 다시 시도하세요.",
  exchange: "Google 토큰 교환에 실패했습니다. 잠시 후 다시 시도하세요.",
  claims: "Google이 돌려준 계정 정보를 확인할 수 없습니다.",
  domain: "허용된 회사 도메인 계정이 아닙니다. 회사 Google 계정으로 로그인하세요.",
  inactive: "비활성 처리된 계정입니다. 관리자에게 문의하세요.",
  customer: "고객사 담당자로 등록된 이메일입니다. 내부 인원만 로그인할 수 있습니다.",
};

/**
 * 로그인 — Google SSO 한 버튼. 처음 로그인하는 내부 인원은 자동으로 등록되고
 * (JIT), 통지 프로필을 채우러 /me 로 안내된다.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string; out?: string };
}) {
  const cfg = readAuthConfig();
  const next = safeNext(searchParams.next);
  const error = searchParams.error ? (ERRORS[searchParams.error] ?? "로그인에 실패했습니다.") : null;

  return (
    <div className="mx-auto mt-16 max-w-md space-y-6">
      <div>
        <h1 className="text-[27px] font-semibold leading-tight tracking-[-0.025em] text-stone-900">
          로그인
        </h1>
        <p className="mt-2 text-sm text-stone-500">
          회사 Google 계정으로 들어옵니다. 처음이면 내부 인원으로 자동 등록되고, Slack ID와
          전화번호를 채우면 알람 순서에 배정될 수 있습니다.
        </p>
      </div>

      {searchParams.out ? (
        <p className="border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">로그아웃했습니다.</p>
      ) : null}
      {error ? (
        <p className="border border-[#f0c9c4] bg-[#fdf3f2] px-3 py-2 text-sm text-[#b42318]">{error}</p>
      ) : null}

      {cfg.enabled ? (
        <a
          href={`/api/auth/login?next=${encodeURIComponent(next)}`}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-stone-700"
        >
          Google로 로그인
          {cfg.allowedDomains.length ? (
            <span className="font-mono text-xs font-normal opacity-70">
              @{cfg.allowedDomains.join(", @")}
            </span>
          ) : null}
        </a>
      ) : (
        <div className="space-y-2 border border-stone-200 bg-white p-4 text-sm">
          <p className="font-medium text-stone-900">SSO 미설정 — 지금은 누구나 접근할 수 있습니다.</p>
          <p className="text-stone-500">
            {cfg.reason}. Vercel 환경변수에 <code className="font-mono text-xs">GOOGLE_CLIENT_ID</code>,{" "}
            <code className="font-mono text-xs">GOOGLE_CLIENT_SECRET</code>,{" "}
            <code className="font-mono text-xs">AUTH_SECRET</code>,{" "}
            <code className="font-mono text-xs">AUTH_ALLOWED_DOMAINS</code> 를 넣으면 켜집니다 (README 참고).
          </p>
          <Link href={next} className="inline-block text-indigo-600 underline">
            계속 →
          </Link>
        </div>
      )}
    </div>
  );
}
