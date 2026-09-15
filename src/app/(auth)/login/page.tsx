import Link from "next/link";
import { redirect } from "next/navigation";
import { readAuthConfig } from "@/lib/auth/config";
import { safeNext } from "@/lib/auth/paths";
import { GoogleMark } from "@/components/auth/google-mark";
import { AuthErrorCard } from "@/components/auth/error-card";
import { getCurrentUser, listAdmins } from "@/server/auth";

export const dynamic = "force-dynamic";

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
      <div className="mb-8 text-center">
        <div className="text-[26px] font-bold tracking-[-0.03em] text-stone-900">
          alert<span className="text-indigo-600">·</span>hub
        </div>
        <p className="mt-1.5 text-[13px] text-stone-500">메가존 알람 허브</p>
      </div>

      {searchParams.out ? (
        <p className="mb-4 border border-stone-200 bg-white px-4 py-2.5 text-center text-[13px] text-stone-600">로그아웃했습니다.</p>
      ) : null}
      {searchParams.error ? (
        <div className="mb-5">
          <AuthErrorCard code={searchParams.error} refCode={searchParams.ref} />
        </div>
      ) : null}

      <div className="border border-stone-200 bg-white p-9">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.025em] text-stone-900">로그인</h1>
        {cfg.enabled ? (
          <>
            <p className="mt-2 text-[13px] leading-relaxed text-stone-500">회사 Google 계정으로 계속하세요.</p>
            <a
              href={`/api/auth/login?next=${encodeURIComponent(next)}`}
              className="mt-7 flex h-12 w-full items-center justify-center gap-[11px] border border-[#b8b2a4] bg-white text-sm font-semibold text-stone-900 transition-colors hover:border-stone-900 hover:bg-stone-50"
            >
              <GoogleMark />
              Google로 로그인
            </a>
            {cfg.allowedDomains.length ? (
              <p className="mt-4 text-center font-mono text-[11px] text-stone-400">
                {cfg.allowedDomains.map((d) => "@" + d).join(" · ")} 계정만
              </p>
            ) : null}
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

      <p className="mt-5 text-center text-xs text-stone-500">
        로그인이 안 되나요?{" "}
        <Link href="/login?help=1" className="text-indigo-600 hover:underline">
          지원 요청
        </Link>
      </p>
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
