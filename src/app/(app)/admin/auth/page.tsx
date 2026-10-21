import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { readAuthConfig } from "@/lib/auth/config";
import { SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { ToneLabel, type AuthTone } from "@/components/auth/primitives";
import { authTest, defaultBotChannel, isBotConfigured } from "@/lib/notify/slack-api";
import { emailNotifier } from "@/lib/notify/email";
import { isSmsConfigured } from "@/lib/notify/twilio";
import { getSignupPolicy } from "@/server/settings";
import { insightPolicy, insightStats } from "@/server/insight";
import { setInsightPolicyAction } from "@/server/insight-actions";
import { PendingButton } from "@/components/pending-button";
import { isPlanEmpty, planDemoCleanup } from "@/server/demo";
import { hubRoleArn } from "@/server/aws";
import { graphPlacement } from "@/server/graph";
import { setGraphPlacementAction } from "@/server/aws-actions";
import { cleanupDemoData } from "@/server/demo-actions";

export const dynamic = "force-dynamic";

function fmt(d: Date | null): string {
  return d ? d.toISOString().slice(0, 16).replace("T", " ") + "Z" : "—";
}

/**
 * SSO 설정 진단 (A6). 로그인 페이지에서 뺀 운영 정보의 제자리 — 환경변수 상태,
 * 허용 목록, 미설정 경고, 승인 대기 수. 관리자 전용(등록 관리 레이아웃이 가른다).
 */
const GROUPS: { title: string; hint: string; items: string[] }[] = [
  {
    title: "인증 공급자",
    hint: "Google SSO · 허용 목록 · 세션",
    items: ["공급자", "허용 도메인", "허용 이메일", "리디렉션 URI", "세션 수명", "관리자", "가입 방식", "승인 대기", "최근 로그인"],
  },
  { title: "통지 채널", hint: "Slack · 이메일 · 문자", items: ["Slack 봇", "Slack 버튼", "Slack 웹훅", "이메일 서버", "SMS 공급자"] },
  { title: "수집 · 웹훅", hint: "알람이 들어오는 입구", items: ["웹훅 인증"] },
  { title: "AI 메모", hint: "발화 때 근거로만 쓴 한 단락 · 채점표", items: ["AI 메모"] },
  { title: "AWS 그래프", hint: "Vercel OIDC → 안내 데스크 역할 → 고객사 읽기 역할", items: ["AWS 그래프"] },
];

export default async function AuthDiagPage({
  searchParams = {},
}: {
  searchParams?: { demo?: string; c?: string; a?: string; p?: string; t?: string };
}) {
  const cfg = readAuthConfig();
  const demo = await planDemoCleanup().catch(() => null);
  const policy = await getSignupPolicy();
  const [pending, admins, lastLogin] = await Promise.all([
    prisma.contact.count({ where: { status: "PENDING" } }),
    prisma.contact.count({ where: { customerId: null, status: "ACTIVE", active: true, role: "ADMIN" } }),
    prisma.contact.findFirst({ where: { lastLoginAt: { not: null } }, orderBy: { lastLoginAt: "desc" }, select: { lastLoginAt: true, name: true } }),
  ]);
  const slackAuth = isBotConfigured() ? await authTest() : null;
  const [ai, aiStats] = await Promise.all([insightPolicy(), insightStats()]);
  const hub = hubRoleArn();
  const placement = await graphPlacement();
  const [readerTotal, readerOk, readerBad] = await Promise.all([
    prisma.awsAccountMap.count({ where: { readerRoleArn: { not: null } } }),
    prisma.awsAccountMap.count({ where: { readerRoleArn: { not: null }, readerError: null, readerCheckedAt: { not: null } } }),
    prisma.awsAccountMap.count({ where: { readerRoleArn: { not: null }, readerError: { not: null } } }),
  ]);
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
  const redirectUri = appUrl ? `${appUrl}/api/auth/callback` : null;
  const openAllow = cfg.allowedDomains.length === 0 && cfg.allowedEmails.length === 0;

  type Row = { item: string; tone: AuthTone; state: string; value: string; action?: { label: string; href: string } };
  const rows: Row[] = [
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
          : "계정 · 접근에서 역할로 관리"
        : "관리자가 없으므로 다음 첫 로그인 계정이 관리자가 됩니다 — 본인이 먼저 로그인하세요",
      action: { label: "인원 보기", href: "/admin/access" },
    },
    {
      item: "가입 방식",
      tone: policy.autoApprove ? "ok" : "info",
      state: policy.autoApprove ? "자동 승인" : "승인제",
      value:
        (policy.autoApprove
          ? "허용 목록·고객사 도메인 계정은 로그인 즉시 활성(내부는 온콜 엔지니어, 고객사는 조회)"
          : "처음 로그인한 계정은 승인 대기 → 관리자가 승인") +
        (policy.source === "setting" ? " · 화면에서 설정함" : policy.source === "env" ? " · AUTH_AUTO_APPROVE 환경변수" : " · 기본값"),
      action: { label: "바꾸기", href: "/admin/access#signup" },
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
      value: pending ? "계정 · 접근에서 승인·거절" : "대기 중인 가입 요청 없음",
      action: pending ? { label: "승인하기", href: "/admin/access#pending" } : undefined,
    },
    {
      item: "Slack 봇",
      tone: isBotConfigured() ? (slackAuth ? "ok" : "err") : "off",
      state: isBotConfigured() ? (slackAuth ? "연결됨" : "토큰 오류") : "없음",
      value: slackAuth
        ? `${slackAuth.team} 워크스페이스 · @${slackAuth.user} · 기본 채널 ${defaultBotChannel() ?? "미설정"}`
        : isBotConfigured()
          ? "auth.test 실패 — 토큰이 폐기됐거나 권한이 없습니다"
          : "SLACK_BOT_TOKEN 없음 · 스코프별 채널은 웹훅 종류만, DM·자동 연결 불가",
    },
    {
      item: "Slack 버튼",
      tone: process.env.SLACK_SIGNING_SECRET ? (isBotConfigured() ? "ok" : "warn") : "off",
      state: process.env.SLACK_SIGNING_SECRET ? (isBotConfigured() ? "켜짐" : "봇 없음") : "없음",
      value: process.env.SLACK_SIGNING_SECRET
        ? isBotConfigured()
          ? `메시지의 확인 · 해결 · 뮤트 버튼 동작 · Request URL ${(process.env.APP_URL ?? "<APP_URL>").replace(/\/+$/, "")}/api/slack/interactive`
          : "서명 시크릿은 있지만 봇 토큰이 없어 버튼이 붙지 않습니다"
        : "SLACK_SIGNING_SECRET 없음 · 메시지 버튼(확인·해결·뮤트)이 동작하지 않습니다. Slack 앱 › Basic Information › Signing Secret",
    },
    {
      item: "Slack 웹훅",
      tone: process.env.SLACK_WEBHOOK_URL ? "ok" : "off",
      state: process.env.SLACK_WEBHOOK_URL ? "설정됨" : "없음",
      value: process.env.SLACK_WEBHOOK_URL ? "전사 폴백 채널로 사용" : "SLACK_WEBHOOK_URL 없음",
    },
    {
      item: "이메일 서버",
      tone: emailNotifier.isConfigured() ? "ok" : "off",
      state: emailNotifier.isConfigured() ? "설정됨" : "없음",
      value: emailNotifier.isConfigured()
        ? `SMTP ${process.env.SMTP_HOST} · 발신 ${process.env.SMTP_FROM}`
        : "SMTP_HOST / SMTP_FROM 없음 · 이메일 통지·확인 불가",
    },
    {
      item: "SMS 공급자",
      tone: isSmsConfigured() ? "ok" : "off",
      state: isSmsConfigured() ? "설정됨" : "없음",
      value: isSmsConfigured()
        ? `Twilio · 발신 ${process.env.TWILIO_FROM}`
        : "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM 없음 · 에스컬레이션 SMS·번호 확인 불가",
    },
    {
      item: "웹훅 인증",
      tone: process.env.INGEST_TOKEN ? (process.env.SNS_VERIFY === "false" ? "warn" : "ok") : "warn",
      state: process.env.INGEST_TOKEN ? "토큰 필수" : "토큰 없음",
      value: [
        process.env.INGEST_TOKEN ? "INGEST_TOKEN 설정됨 — 웹훅 URL 에 ?token= 필요" : "INGEST_TOKEN 없음 — URL 을 아는 누구나 알람을 넣을 수 있습니다. 실제 고객사 투입 전 설정",
        process.env.SNS_VERIFY === "false" ? "SNS 서명 검증 꺼짐(SNS_VERIFY=false)" : "SNS 서명 검증 켜짐",
        process.env.PAGERDUTY_WEBHOOK_SECRET ? "PagerDuty 서명 필수" : "PagerDuty 서명 미설정",
      ].join(" · "),
    },
    {
      item: "AI 메모",
      tone: ai.enabled ? "ok" : ai.switchedOn && !ai.hasKey ? "warn" : "off",
      state: ai.enabled ? "켜짐" : ai.switchedOn && !ai.hasKey ? "키 없음" : "꺼짐",
      value: [
        ai.hasKey ? `ANTHROPIC_API_KEY 설정됨 · ${aiStats.model}` : "ANTHROPIC_API_KEY 없음 — 스위치를 켜도 만들지 않습니다",
        ai.source === "setting" ? "화면에서 정함" : ai.source === "env" ? "환경변수 AI_INSIGHTS" : "기본값(꺼짐)",
        aiStats.line,
      ].join(" · "),
    },
    {
      item: "AWS 그래프",
      tone: !hub ? "off" : readerBad ? "warn" : readerOk ? "ok" : "warn",
      state: !hub ? "미설정" : readerOk ? `계정 ${readerOk}개 연결` : readerTotal ? "확인 전" : "역할 없음",
      value: [
        hub ? `안내 데스크 ${hub}` : "AWS_ROLE_ARN 없음 — 그래프를 받지 않습니다",
        process.env.VERCEL ? "Vercel OIDC" : "로컬 자격 증명",
        `읽기 역할 ${readerTotal}개 · 연결 ${readerOk} · 실패 ${readerBad}`,
        `Slack 위치: ${placement === "inline" ? "메시지 본문 안" : "스레드"}`,
        "Slack 첨부에 files:write 필요",
      ].join(" · "),
      action: { label: "계정 매핑", href: "/admin/org" },
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
          <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-stone-900">시스템 진단</h2>
          <span className="border border-[#e0dcd3] px-[7px] py-[3px] font-mono text-[10px] font-bold tracking-[0.08em] text-[#b54708]">
            관리자 전용
          </span>
        </div>
        <p className="mt-2 text-xs text-stone-500">
          환경변수로 정해지는 연결 상태와 미설정 경고. 값은 Vercel 환경변수에서 바꾸고 재배포합니다
          (README · <code className="font-mono">npm run env:push</code>). 가입 방식·승인·인원은{" "}
          <Link href="/admin/access" className="text-indigo-600 underline">계정 · 접근</Link>에서 다룹니다.
        </p>
      </div>

      {GROUPS.map((g) => (
        <div key={g.title} className="border border-stone-200 bg-white">
          <div className="flex items-baseline gap-2 border-b border-stone-200 px-5 py-3">
            <h3 className="text-[13px] font-semibold text-stone-900">{g.title}</h3>
            <span className="text-xs text-stone-400">{g.hint}</span>
          </div>
          <div className="grid h-8 grid-cols-[196px_128px_1fr_168px] items-center gap-3.5 border-b border-[#eeebe4] px-5 font-mono text-[10px] font-bold tracking-[0.11em] text-stone-400">
            <span>항목</span>
            <span>상태</span>
            <span>값 · 비고</span>
            <span className="text-right">동작</span>
          </div>
          {rows
            .filter((r) => g.items.includes(r.item))
            .map((r) => (
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
          {g.title === "인증 공급자" ? (
            <>
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
            </>
          ) : null}
          {g.title === "AWS 그래프" ? (
            <form action={setGraphPlacementAction} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5 text-sm">
              <input type="hidden" name="placement" value={placement === "inline" ? "thread" : "inline"} />
              <span className="text-xs text-[#4a4842]">
                그래프 위치 — 지금 <b>{placement === "inline" ? "메시지 본문 안" : "스레드(댓글)"}</b>. 본문 안은 채널에서 바로 보이지만 알람마다
                그래프만큼 길어집니다. 끼워 넣기가 실패하면 자동으로 스레드에 붙입니다.
              </span>
              <PendingButton
                pendingLabel="저장 중…"
                className="inline-flex h-7 items-center border border-stone-200 bg-white px-3 text-xs font-medium text-stone-900 hover:border-stone-400"
              >
                {placement === "inline" ? "스레드로 바꾸기" : "본문 안으로 바꾸기"}
              </PendingButton>
            </form>
          ) : null}
          {g.title === "AI 메모" ? (
            <form action={setInsightPolicyAction} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5 text-sm">
              <input type="hidden" name="insights" value={ai.switchedOn ? "off" : "on"} />
              <span className="text-xs text-[#4a4842]">
                켜면 통지가 나간 알람마다 같은 고객사의 해결 기록·런북·이력을 Anthropic API 로 보내 메모를 만듭니다. 고객사별 거부는
                고객사 화면에서. 채점은 제안 분류가 실제 분류와 맞았는지로 잽니다.
              </span>
              <PendingButton
                pendingLabel="저장 중…"
                className="inline-flex h-7 items-center border border-stone-200 bg-white px-3 text-xs font-medium text-stone-900 hover:border-stone-400"
              >
                {ai.switchedOn ? "끄기" : "켜기"}
              </PendingButton>
            </form>
          ) : null}
        </div>
      ))}

      {demo ? (
        <div id="demo" className="border border-stone-200 bg-white">
          <div className="flex items-baseline gap-2 border-b border-stone-200 px-5 py-3">
            <h3 className="text-[13px] font-semibold text-stone-900">데모 데이터 정리</h3>
            <span className="text-xs text-stone-400">실제 고객사를 넣기 전에 한 번</span>
          </div>
          <div className="space-y-3 px-5 py-4 text-sm">
            {searchParams.demo === "done" ? (
              <p className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
                정리 완료 — 고객사 {searchParams.c ?? 0} · 알람 {searchParams.a ?? 0} · 내부 인원 {searchParams.p ?? 0} · 빈 팀{" "}
                {searchParams.t ?? 0} 삭제.
              </p>
            ) : null}
            {searchParams.demo === "confirm" ? (
              <p className="border border-[#f3d9b8] bg-[#fdf6ec] px-3 py-2 text-[13px] text-[#b54708]">
                확인 칸에 <b>정리</b> 를 정확히 입력해야 지웁니다.
              </p>
            ) : null}
            {demo.reseeds ? (
              <p className="border border-[#f3d9b8] bg-[#fdf6ec] px-3 py-2 text-[13px] text-[#b54708]">
                Vercel 환경변수 <code className="font-mono">SEED_DEMO=false</code> 가 아직 없습니다. 먼저 넣고 재배포하세요 — 안 그러면
                다음 배포 때 데모가 다시 채워집니다.
              </p>
            ) : null}
            {isPlanEmpty(demo) ? (
              <p className="text-stone-500">지울 데모 데이터가 없습니다. 남은 고객사 {demo.keepCustomers}곳은 그대로입니다.</p>
            ) : (
              <>
                <ul className="space-y-1 text-[13px] text-stone-700">
                  <li>
                    고객사 {demo.customers.length}곳 <span className="text-stone-400">(하위 프로젝트·서비스·계정 매핑·담당자·팀·규칙 포함)</span>:{" "}
                    {demo.customers.map((c) => c.name).join(", ") || "-"}
                  </li>
                  <li>알람 {demo.alerts}건 <span className="text-stone-400">(데모 계정 ID로 들어온 것)</span></li>
                  <li>
                    내부 데모 인원 {demo.internal.length}명: {demo.internal.map((c) => c.name).join(", ") || "-"}
                  </li>
                  <li className="text-stone-500">남는 고객사 {demo.keepCustomers}곳 — 손대지 않습니다.</li>
                </ul>
                <form action={cleanupDemoData} className="flex flex-wrap items-center gap-3 border-t border-stone-100 pt-3">
                  <label className="text-xs text-stone-500">
                    되돌릴 수 없습니다. 확인하려면 <b className="text-stone-800">정리</b> 입력
                  </label>
                  <input
                    name="confirm"
                    autoComplete="off"
                    className="h-8 w-24 border border-stone-300 bg-white px-2 text-sm"
                    placeholder="정리"
                  />
                  <PendingButton
                    pendingLabel="지우는 중…"
                    className="inline-flex h-8 items-center bg-[#b42318] px-3 text-xs font-semibold text-white hover:bg-[#912018]"
                  >
                    데모 데이터 삭제
                  </PendingButton>
                </form>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
