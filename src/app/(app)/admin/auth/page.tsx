import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { readAuthConfig } from "@/lib/auth/config";
import { SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { ToneLabel, type AuthTone } from "@/components/auth/primitives";

export const dynamic = "force-dynamic";

function fmt(d: Date | null): string {
  return d ? d.toISOString().slice(0, 16).replace("T", " ") + "Z" : "—";
}

/**
 * SSO 설정 진단 (A6). 로그인 페이지에서 뺀 운영 정보의 제자리 — 환경변수 상태,
 * 허용 목록, 미설정 경고, 승인 대기 수. 관리자 전용(등록 관리 레이아웃이 가른다).
 */
export default async function AuthDiagPage() {
  const cfg = readAuthConfig();
  const [pending, admins, lastLogin] = await Promise.all([
    prisma.contact.count({ where: { customerId: null, status: "PENDING" } }),
    prisma.contact.count({ where: { customerId: null, status: "ACTIVE", active: true, role: "ADMIN" } }),
    prisma.contact.findFirst({ where: { lastLoginAt: { not: null } }, orderBy: { lastLoginAt: "desc" }, select: { lastLoginAt: true, name: true } }),
  ]);
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
  const redirectUri = appUrl ? `${appUrl}/api/auth/callback` : null;
  const openAllow = cfg.allowedDomains.length === 0 && cfg.allowedEmails.length === 0;

  const rows: { item: string; tone: AuthTone; state: string; value: string; action?: { label: string; href: string } }[] = [
    {
      item: "공급자",
      tone: cfg.enabled ? "ok" : "warn",
      state: cfg.enabled ? "연결됨" : "미설정",
      value: cfg.enabled
        ? `Google — 클라이언트 …${cfg.clientId.slice(-8)}`
        : `Google — ${cfg.reason ?? "클라이언트 미등록"}`,
      action: { label: "설정 안내", href: "https://github.com/hkjs96/alert-hub#google-sso--jit-등록-선택" },
    },
    {
      item: "허용 도메인",
      tone: cfg.allowedDomains.length ? "ok" : openAllow ? "warn" : "off",
      state: cfg.allowedDomains.length ? `${cfg.allowedDomains.length}개` : "없음",
      value: cfg.allowedDomains.length ? cfg.allowedDomains.map((d) => "@" + d).join(", ") : openAllow ? "비어 있음 · 모든 Google 계정 허용" : "개별 이메일만 허용",
    },
    {
      item: "허용 이메일",
      tone: cfg.allowedEmails.length ? "ok" : "off",
      state: cfg.allowedEmails.length ? `${cfg.allowedEmails.length}명` : "없음",
      value: cfg.allowedEmails.join(", ") || "—",
    },
    {
      item: "관리자",
      tone: admins ? "ok" : "warn",
      state: admins ? `${admins}명` : "없음",
      value: admins
        ? cfg.bootstrapAdmins.length
          ? `부트스트랩: ${cfg.bootstrapAdmins.join(", ")}`
          : "팀 · 내부 인원에서 역할로 관리"
        : "관리자가 없으므로 다음 첫 로그인 계정이 관리자가 됩니다 — 본인이 먼저 로그인하세요",
      action: { label: "인원 보기", href: "/admin/teams" },
    },
    {
      item: "가입 방식",
      tone: cfg.autoApprove ? "ok" : "info",
      state: cfg.autoApprove ? "자동 승인" : "승인제",
      value: cfg.autoApprove
        ? "허용 목록 계정은 로그인 즉시 온콜 엔지니어로 활성 (AUTH_AUTO_APPROVE=true)"
        : "허용 목록 계정도 관리자 승인 뒤 활성 · AUTH_AUTO_APPROVE=true 로 바꿀 수 있음",
    },
    {
      item: "리디렉션 URI",
      tone: redirectUri ? "ok" : "warn",
      state: redirectUri ? "정상" : "APP_URL 없음",
      value: redirectUri ?? "APP_URL 이 없어 요청 호스트로 대체합니다 — Google 콘솔의 URI와 다를 수 있습니다",
    },
    {
      item: "세션 수명",
      tone: "ok",
      state: "정상",
      value: `${SESSION_TTL_SECONDS / 86400}일 · 서명 쿠키 · 비활성·거절은 다음 요청에서 즉시 차단`,
    },
    {
      item: "승인 대기",
      tone: pending ? "warn" : "ok",
      state: pending ? `${pending}명` : "없음",
      value: pending ? "팀 · 내부 인원에서 승인·거절" : "대기 중인 가입 요청 없음",
      action: pending ? { label: "승인하기", href: "/admin/teams#pending" } : undefined,
    },
    {
      item: "최근 로그인",
      tone: lastLogin ? "ok" : "off",
      state: lastLogin ? "기록 있음" : "없음",
      value: lastLogin ? `${lastLogin.name} · ${fmt(lastLogin.lastLoginAt)}` : "아직 SSO 로그인 이력이 없습니다",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2.5">
          <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-stone-900">인증 공급자</h2>
          <span className="border border-[#e0dcd3] px-[7px] py-[3px] font-mono text-[10px] font-bold tracking-[0.08em] text-[#b54708]">
            관리자 전용
          </span>
        </div>
        <p className="mt-2 text-xs text-stone-500">
          환경변수 상태, 도메인 허용 목록, 미설정 경고는 이 화면에만 나타납니다. 값은 Vercel 환경변수에서 바꾸고 재배포합니다
          (README · <code className="font-mono">npm run env:push</code>).
        </p>
      </div>

      <div className="border border-stone-200 bg-white">
        <div className="grid h-8 grid-cols-[196px_128px_1fr_168px] items-center gap-3.5 border-b border-[#eeebe4] px-5 font-mono text-[10px] font-bold tracking-[0.11em] text-stone-400">
          <span>항목</span>
          <span>상태</span>
          <span>값 · 비고</span>
          <span className="text-right">동작</span>
        </div>
        {rows.map((r) => (
          <div key={r.item} className="grid grid-cols-[196px_128px_1fr_168px] items-center gap-3.5 border-b border-[#f4f1ea] px-5 py-3.5">
            <span className="text-[13px] font-medium text-stone-900">{r.item}</span>
            <ToneLabel tone={r.tone}>{r.state}</ToneLabel>
            <span className="truncate font-mono text-xs text-stone-500" title={r.value}>
              {r.value}
            </span>
            <div className="flex justify-end">
              {r.action ? (
                <Link
                  href={r.action.href}
                  className="inline-flex h-7 items-center border border-stone-200 bg-white px-3 text-xs font-medium text-stone-900 hover:border-stone-400"
                >
                  {r.action.label}
                </Link>
              ) : null}
            </div>
          </div>
        ))}
        {!cfg.enabled ? (
          <div className="flex items-center gap-2.5 px-5 py-3.5">
            <ToneLabel tone="warn">주의</ToneLabel>
            <span className="text-xs text-[#4a4842]">
              SSO 미설정 상태에서는 <span className="font-semibold">누구나 접근 가능</span>합니다. 실제 고객사를 넣기 전에 공급자를
              연결하세요.
            </span>
          </div>
        ) : openAllow ? (
          <div className="flex items-center gap-2.5 px-5 py-3.5">
            <ToneLabel tone="warn">주의</ToneLabel>
            <span className="text-xs text-[#4a4842]">
              허용 도메인·이메일이 모두 비어 있어 <span className="font-semibold">어떤 Google 계정이든</span> 가입 요청을 만들 수
              있습니다(승인 전엔 아무것도 못 보지만 목록이 쌓입니다).
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
