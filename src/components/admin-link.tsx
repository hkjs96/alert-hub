import Link from "next/link";
import { cache } from "react";
import { authMode, getCurrentUser } from "@/server/auth";

/** 요청당 한 번만 계산 — 한 화면에 관리 링크가 여러 개여도 세션 조회는 한 번. */
const canOpenAdmin = cache(async (): Promise<boolean> => {
  if (authMode() === "open") return true;
  const me = await getCurrentUser();
  return !!me && me.status === "ACTIVE" && me.role === "ADMIN" && !me.customerId;
});

/**
 * 등록 관리(/admin) 로 가는 링크. 관리자가 아니면 눌러도 접근 거부 화면뿐이니
 * 링크 대신 같은 모양의 글자로만 보인다.
 */
export async function AdminLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (await canOpenAdmin()) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  const plain = (className ?? "")
    .split(/\s+/)
    .filter((c) => c && !c.startsWith("hover:") && c !== "underline" && !c.startsWith("text-indigo"))
    .join(" ");
  return <span className={plain}>{children}</span>;
}
