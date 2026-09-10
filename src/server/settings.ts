import { prisma } from "@/lib/prisma";
import { readAuthConfig } from "@/lib/auth/config";

// 화면에서 바꾸는 운영 설정. DB 값이 있으면 그것, 없으면 환경변수. 조회 실패는
// 환경변수로 떨어진다(설정 테이블 때문에 로그인이 죽으면 안 된다).

export const SIGNUP_AUTO_APPROVE = "signup.autoApprove";

export async function getSetting(key: string): Promise<string | null> {
  try {
    return (await prisma.setting.findUnique({ where: { key } }))?.value ?? null;
  } catch {
    return null;
  }
}

export async function setSetting(key: string, value: string, by: string | null): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value, updatedBy: by },
    update: { value, updatedBy: by },
  });
}

export interface SignupPolicy {
  autoApprove: boolean;
  /** "setting" = 화면에서 정함, "env" = 환경변수, "default" = 둘 다 없음(승인제) */
  source: "setting" | "env" | "default";
}

export async function getSignupPolicy(): Promise<SignupPolicy> {
  const v = await getSetting(SIGNUP_AUTO_APPROVE);
  if (v === "on" || v === "off") return { autoApprove: v === "on", source: "setting" };
  const env = process.env.AUTH_AUTO_APPROVE;
  if (env !== undefined && env !== "") return { autoApprove: readAuthConfig().autoApprove, source: "env" };
  return { autoApprove: false, source: "default" };
}

export async function isAutoApprove(): Promise<boolean> {
  return (await getSignupPolicy()).autoApprove;
}
