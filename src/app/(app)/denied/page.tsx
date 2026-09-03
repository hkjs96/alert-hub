import { redirect } from "next/navigation";
import { AccessDenied } from "@/components/auth/access-denied";
import { authMode, getCurrentUser } from "@/server/auth";

export const dynamic = "force-dynamic";

/** 권한 부족으로 막힌 화면의 착지점 (A4 우측). */
export default async function DeniedPage({ searchParams }: { searchParams: { screen?: string; rq?: string } }) {
  if (authMode() === "open") redirect("/");
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  return (
    <AccessDenied
      screen={searchParams.screen || "등록 관리"}
      currentRole={me.role}
      requiredRole="ADMIN"
      userName={me.name}
      pinged={searchParams.rq}
    />
  );
}
