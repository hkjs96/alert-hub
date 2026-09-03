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
  /** 소문자 도메인 목록. 비어 있으면 도메인 제한 없음(경고). */
  allowedDomains: string[];
}

export function readAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const secret = env.AUTH_SECRET?.trim() ?? "";
  const allowedDomains = parseDomains(env.AUTH_ALLOWED_DOMAINS);

  const missing = [
    !clientId && "GOOGLE_CLIENT_ID",
    !clientSecret && "GOOGLE_CLIENT_SECRET",
    !secret && "AUTH_SECRET",
  ].filter(Boolean) as string[];

  if (missing.length === 3) {
    return { enabled: false, reason: "SSO 미설정", clientId, clientSecret, secret, allowedDomains };
  }
  if (missing.length > 0) {
    return {
      enabled: false,
      reason: `SSO 설정 불완전 — ${missing.join(", ")} 누락`,
      clientId,
      clientSecret,
      secret,
      allowedDomains,
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
    };
  }
  return { enabled: true, clientId, clientSecret, secret, allowedDomains };
}

export function parseDomains(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/**
 * 이메일 도메인 허용 여부. 목록이 비어 있으면 모두 허용 — 운영에서는 반드시
 * AUTH_ALLOWED_DOMAINS를 두라고 README가 말한다. 서브도메인은 허용하지
 * 않는다(`corp.example.com`은 `example.com`과 다른 도메인).
 */
export function isEmailAllowed(email: string, domains: string[]): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain) return false;
  if (domains.length === 0) return true;
  return domains.includes(domain);
}
