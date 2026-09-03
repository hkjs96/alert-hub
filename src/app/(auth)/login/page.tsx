import Link from "next/link";
import { redirect } from "next/navigation";
import { readAuthConfig } from "@/lib/auth/config";
import { safeNext } from "@/lib/auth/paths";
import { GoogleMark } from "@/components/auth/google-mark";
import { AuthErrorCard } from "@/components/auth/error-card";
import { overline } from "@/components/auth/primitives";
import { getCurrentUser, listAdmins } from "@/server/auth";

export const dynamic = "force-dynamic";

const control =
  "h-[38px] w-full border border-stone-200 bg-white px-3 text-[13px] text-stone-900 placeholder:text-stone-400 focus:border-stone-900 focus:outline-none";

/**
 * 로그인 (A1). 앱 셸 없음, 단일 SSO 진입점. 환경변수 상태·허용 목록 같은
 * 운영 정보는 여기 없다 — 관리자 진단(/admin/auth)의 몫(원칙 02).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string; ref?: string; out?: string; help?: string };
}) {
  const cfg = readAuthConfig();
  const next = safeNext(searchParams.next);
  const me = cfg.enabled ? await getCurrentUser() : null;
  if (me && !searchParams.error) redirect(me.status === "PENDING" ? "/pending" : next);
  const admins = searchParams.help || searchParams.error ? await listAdmins() : [];

  return (
    <div className="w-[400px] max-w-full">
      {searchParams.out ? (
        <p className="mb-4 border border-stone-200 bg-white px-4 py-2.5 text-[13px] text-stone-600">로그아웃했습니다.</p>
      ) : null}
      {searchParams.error ? (
        <div className="mb-5">
          <AuthErrorCard code={searchParams.error} refCode={searchParams.ref} />
        </div>
      ) : null}

      <div className="border border-stone-200 bg-white px-9 pb-[30px] pt-9">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.025em] text-stone-900">로그인</h1>
        {cfg.enabled ? (
          <>
            <p className="mt-2 text-[13px] leading-relaxed text-stone-500">회사 Google 계정으로 계속하세요.</p>
            <a
              href={`/api/auth/login?next=${encodeURIComponent(next)}`}
              className="mt-[26px] flex h-11 w-full items-center justify-center gap-[11px] border border-[#b8b2a4] bg-white text-sm font-semibold text-stone-900 transition-colors hover:border-stone-900 hover:bg-stone-50"
            >
              <GoogleMark />
              Google로 로그인
            </a>

            <div className="mt-[26px] flex items-center gap-3">
              <span className="h-px flex-1 bg-[#eeebe4]" />
              <span className="font-mono text-[10px] font-bold tracking-[0.11em] text-stone-300">OR</span>
              <span className="h-px flex-1 bg-[#eeebe4]" />
            </div>

            <form action="/api/auth/login" method="get" className="mt-6 flex flex-col gap-[11px]">
              <input type="hidden" name="next" value={next} />
              <label className="block">
                <span className={`mb-2 block ${overline}`}>회사 이메일</span>
                <input name="login_hint" type="email" placeholder="name@company.com" className={control} />
              </label>
              <button
                type="submit"
                className="h-[38px] w-full border border-stone-200 bg-white text-[13px] font-medium text-stone-500 transition-colors hover:border-stone-400 hover:text-stone-900"
              >
                SSO로 계속
              </button>
              <p className="text-xs leading-relaxed text-stone-400">도메인에 연결된 인증 공급자로 이동합니다.</p>
            </form>
          </>
        ) : (
          <>
            <p className="mt-2 text-[13px] leading-relaxed text-stone-500">
              인증 공급자가 아직 연결되지 않았습니다. 연결될 때까지는 로그인 없이 사용할 수 있습니다.
            </p>
            <Link
              href={next}
              className="mt-[26px] flex h-11 w-full items-center justify-center border border-stone-900 bg-stone-900 text-sm font-semibold text-white transition-colors hover:bg-black"
            >
              계속
            </Link>
          </>
        )}
      </div>

      <div className="mt-[18px] flex items-center justify-between text-xs text-stone-500">
        <span>
          로그인이 안 되나요?{" "}
          <Link href="/login?help=1" className="text-indigo-600 hover:underline">
            지원 요청
          </Link>
        </span>
      </div>
      {searchParams.help || searchParams.error ? (
        <div className="mt-3 border border-dashed border-stone-200 bg-white/60 px-4 py-3 text-xs leading-relaxed text-stone-500">
          {admins.length ? (
            <>
              승인·접근 문의는 관리자에게:{" "}
              {admins.map((a, i) => (
                <span key={a.id}>
                  {i ? ", " : ""}
                  <span className="font-medium text-stone-700">{a.name}</span>
                  {a.email ? <span className="font-mono"> &lt;{a.email}&gt;</span> : null}
                </span>
              ))}
            </>
          ) : (
            "아직 지정된 관리자가 없습니다. 이 도구를 배포한 담당자에게 문의하세요."
          )}
          {searchParams.ref ? <> · 참조 코드 <span className="font-mono">{searchParams.ref}</span></> : null}
        </div>
      ) : null}
    </div>
  );
}
