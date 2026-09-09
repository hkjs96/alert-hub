import { redirect } from "next/navigation";
import { AccessDenied } from "@/components/auth/access-denied";
import { authMode, getCurrentUser } from "@/server/auth";

export const dynamic = "force-dynamic";

/** 권한 부족으로 막힌 화면의 착지점 (A4 우측). */
export default async function DeniedPage({ searchParams }: { searchParams: { screen?: string; rq?: string; scope?: string } }) {
  if (authMode() === "open") redirect("/");
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (searchParams.scope) {
    return (
      <AccessDenied
        screen="담당 밖 알람"
        currentRole={me.role}
        requiredRole={me.role}
        userName={me.name}
        pinged={searchParams.rq}
        reason="이 알람은 담당 고객사 밖에 있습니다. 담당 배정을 받거나 관리자에게 전체 보기를 요청하세요."
      />
    );
  }
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
