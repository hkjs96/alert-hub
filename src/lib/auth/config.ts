// SSO 설정 읽기 — 순수 함수. 환경변수가 갖춰지지 않으면 인증은 "꺼짐"이고
// 앱은 지금처럼 누구나 접근 가능한 상태로 동작한다(헤더에 표시). 절반만
// 설정된 경우는 이유를 남겨 화면에서 보여 준다.

export interface AuthConfig {
  enabled: boolean;
  /** enabled=false일 때 사람이 읽을 이유. */
  reason?: string;
  clientId: string;
  clientSecret: string;
  secret: string;
  /** 소문자 도메인 목록. */
  allowedDomains: string[];
  /** 도메인과 무관하게 허용하는 개별 이메일(소문자). 외부 협력자·개인 계정용. */
  allowedEmails: string[];
  /** 첫 로그인에 바로 ADMIN·활성이 되는 이메일. (관리자가 아직 없으면 첫 로그인이 관리자.) */
  bootstrapAdmins: string[];
  /** true 면 허용 목록 계정은 승인 없이 바로 활성(온콜 엔지니어). false 면 승인 대기. */
  autoApprove: boolean;
}

/**
 * 소유자 계정 — 환경변수와 무관하게 항상 허용 목록 + 관리자. 화면에서 실수로 강등·비활성해도
 * 다음 로그인(그리고 매 요청)에서 관리자로 돌아온다. 잠금 방지용 예외.
 */
export const OWNER_EMAILS = ["jsmini3814@gmail.com"];

export function isOwnerEmail(email: string | null | undefined): boolean {
  return !!email && OWNER_EMAILS.includes(email.trim().toLowerCase());
}

export function readAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const secret = env.AUTH_SECRET?.trim() ?? "";
  const allowedDomains = parseDomains(env.AUTH_ALLOWED_DOMAINS);
  // 소유자는 허용 목록에 섞지 않는다(목록이 비면 "전부 허용"인 의미가 바뀌므로) — 콜백이 따로 통과시킨다.
  const allowedEmails = parseEmails(env.AUTH_ALLOWED_EMAILS);
  const bootstrapAdmins = Array.from(new Set([...parseEmails(env.AUTH_BOOTSTRAP_ADMINS), ...OWNER_EMAILS]));
  const autoApprove = /^(true|1|yes)$/i.test(env.AUTH_AUTO_APPROVE?.trim() ?? "");

  const missing = [
    !clientId && "GOOGLE_CLIENT_ID",
    !clientSecret && "GOOGLE_CLIENT_SECRET",
    !secret && "AUTH_SECRET",
  ].filter(Boolean) as string[];

  if (missing.length === 3) {
    return { enabled: false, reason: "SSO 미설정", clientId, clientSecret, secret, allowedDomains, allowedEmails, bootstrapAdmins, autoApprove };
  }
  if (missing.length > 0) {
    return {
      enabled: false,
      reason: `SSO 설정 불완전 — ${missing.join(", ")} 누락`,
      clientId,
      clientSecret,
      secret,
      allowedDomains,
      allowedEmails,
      bootstrapAdmins,
      autoApprove,
    };
  }
  if (secret.length < 16) {
    return {
      enabled: false,
      reason: "AUTH_SECRET이 너무 짧음 (16자 이상)",
      clientId,
      clientSecret,
      secret,
      allowedDomains,
      allowedEmails,
      bootstrapAdmins,
      autoApprove,
    };
  }
  return { enabled: true, clientId, clientSecret, secret, allowedDomains, allowedEmails, bootstrapAdmins, autoApprove };
}

export function parseDomains(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function parseEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

/**
 * 이메일 허용 여부. 개별 이메일 목록에 있으면 도메인과 무관하게 허용, 아니면
 * 도메인 목록으로 판단. 두 목록이 모두 비어 있으면 모두 허용 — 운영에서는
 * 반드시 하나는 두라고 README가 말한다. 서브도메인은 허용하지 않는다
 * (`corp.example.com`은 `example.com`과 다른 도메인).
 */
export function isEmailAllowed(email: string, domains: string[], emails: string[] = []): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const lower = email.toLowerCase();
  const domain = lower.slice(at + 1);
  if (!domain) return false;
  if (emails.includes(lower)) return true;
  if (domains.length === 0 && emails.length === 0) return true;
  return domains.includes(domain);
}
