import { describe, expect, it } from "vitest";
import { isEmailAllowed, parseDomains, readAuthConfig } from "@/lib/auth/config";
import { signSession, verifySession } from "@/lib/auth/session";
import { decodeIdToken, validateClaims, authorizeUrl } from "@/lib/auth/google";
import { isPublicPath, safeNext } from "@/lib/auth/paths";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("SSO 설정", () => {
  it("셋 다 비어 있으면 꺼짐(미설정), 앱은 그대로 열린다", () => {
    const c = readAuthConfig({});
    expect(c.enabled).toBe(false);
    expect(c.reason).toBe("SSO 미설정");
  });
  it("일부만 있으면 꺼짐 + 누락 항목을 이유로 남긴다", () => {
    const c = readAuthConfig({ GOOGLE_CLIENT_ID: "x", AUTH_SECRET: SECRET });
    expect(c.enabled).toBe(false);
    expect(c.reason).toContain("GOOGLE_CLIENT_SECRET");
  });
  it("짧은 AUTH_SECRET은 거부", () => {
    const c = readAuthConfig({ GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "y", AUTH_SECRET: "short" });
    expect(c.enabled).toBe(false);
    expect(c.reason).toContain("AUTH_SECRET");
  });
  it("완비되면 켜지고 도메인 목록을 정규화한다", () => {
    const c = readAuthConfig({
      GOOGLE_CLIENT_ID: "x",
      GOOGLE_CLIENT_SECRET: "y",
      AUTH_SECRET: SECRET,
      AUTH_ALLOWED_DOMAINS: " @Example.com, msp.co.kr ",
    });
    expect(c.enabled).toBe(true);
    expect(c.allowedDomains).toEqual(["example.com", "msp.co.kr"]);
  });
  it("도메인 허용: 대소문자 무시, 서브도메인은 별개, 목록 비면 전부 허용", () => {
    expect(isEmailAllowed("A@Example.COM", ["example.com"])).toBe(true);
    expect(isEmailAllowed("a@corp.example.com", ["example.com"])).toBe(false);
    expect(isEmailAllowed("a@gmail.com", ["example.com"])).toBe(false);
    expect(isEmailAllowed("a@gmail.com", [])).toBe(true);
    expect(isEmailAllowed("not-an-email", [])).toBe(false);
    expect(parseDomains(undefined)).toEqual([]);
  });
});

describe("세션 쿠키", () => {
  it("서명 → 검증 왕복", async () => {
    const t = await signSession({ sub: "c1", email: "a@x.com", name: "김도윤" }, SECRET, 1000);
    const p = await verifySession(t, SECRET, 1001);
    expect(p?.sub).toBe("c1");
    expect(p?.name).toBe("김도윤");
    expect(p?.exp).toBe(1000 + 7 * 24 * 3600);
  });
  it("만료·변조·다른 비밀·쓰레기 입력은 모두 null", async () => {
    const t = await signSession({ sub: "c1", email: "a@x.com", name: "n", exp: 2000 }, SECRET, 1000);
    expect(await verifySession(t, SECRET, 2000)).toBeNull();
    expect(await verifySession(t, "another-secret-another-secret", 1500)).toBeNull();
    expect(await verifySession(t.slice(0, -2) + "zz", SECRET, 1500)).toBeNull();
    const [body, sig] = t.split(".");
    expect(await verifySession(body + "x." + sig, SECRET, 1500)).toBeNull();
    expect(await verifySession("", SECRET)).toBeNull();
    expect(await verifySession("nodot", SECRET)).toBeNull();
    expect(await verifySession(t, "", 1500)).toBeNull();
  });
});

function fakeIdToken(claims: Record<string, unknown>): string {
  const b = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "RS256" })}.${b(claims)}.sig`;
}

describe("Google id_token 클레임", () => {
  const base = {
    iss: "https://accounts.google.com",
    aud: "cid",
    sub: "123",
    exp: 5000,
    nonce: "n1",
    email: "Kim@Example.com",
    email_verified: true,
    name: "김도윤",
  };
  it("정상 토큰은 이메일을 소문자로 돌려준다", () => {
    const r = validateClaims(decodeIdToken(fakeIdToken(base)), { clientId: "cid", nonce: "n1", now: 4000 });
    expect(r).toEqual({ ok: true, email: "kim@example.com", name: "김도윤", sub: "123" });
  });
  it.each([
    ["aud", { aud: "other" }],
    ["iss", { iss: "evil" }],
    ["exp", { exp: 3000 }],
    ["nonce", { nonce: "n2" }],
    ["email_verified", { email_verified: false }],
    ["email", { email: undefined }],
  ])("%s가 어긋나면 거부", (_k, patch) => {
    const r = validateClaims(decodeIdToken(fakeIdToken({ ...base, ...patch })), { clientId: "cid", nonce: "n1", now: 4000 });
    expect(r.ok).toBe(false);
  });
  it("깨진 토큰은 null → 거부", () => {
    expect(decodeIdToken("garbage")).toBeNull();
    expect(validateClaims(null, { clientId: "cid", nonce: "n1" }).ok).toBe(false);
  });
  it("authorize URL은 state/nonce/redirect를 실어 나른다", () => {
    const u = new URL(authorizeUrl({ clientId: "cid", redirectUri: "https://h/api/auth/callback", state: "s", nonce: "n", hd: "x.com" }));
    expect(u.searchParams.get("state")).toBe("s");
    expect(u.searchParams.get("nonce")).toBe("n");
    expect(u.searchParams.get("hd")).toBe("x.com");
    expect(u.searchParams.get("scope")).toContain("email");
  });
});

describe("공개 경로 · 리다이렉트", () => {
  it("웹훅·크론·인증·로그인·정적 자산은 세션 없이 통과", () => {
    for (const p of ["/api/webhooks/generic", "/api/cron/notify", "/api/auth/callback", "/login", "/_next/static/x.js", "/favicon.ico"]) {
      expect(isPublicPath(p)).toBe(true);
    }
    for (const p of ["/", "/alerts/x", "/admin/org", "/me"]) expect(isPublicPath(p)).toBe(false);
  });
  it("next는 사이트 내부 경로만", () => {
    expect(safeNext("/admin/org?level=customer")).toBe("/admin/org?level=customer");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/api/auth/logout")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
