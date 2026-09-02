"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * v2 잉크 밑줄 탭. 활성 판정은 pathname 정규식 — 서버 컴포넌트 셸에서 현재
 * 경로를 알 수 없어서 이 부분만 클라이언트로 뺐다 (표시 전용, 동작은 링크).
 */
export function NavTab({
  href,
  label,
  pattern,
  className,
  activeClassName,
  inactiveClassName,
}: {
  href: string;
  label: string;
  /** RegExp source tested against the current pathname. */
  pattern: string;
  className: string;
  activeClassName: string;
  inactiveClassName: string;
}) {
  const pathname = usePathname() ?? "/";
  const active = new RegExp(pattern).test(pathname);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`${className} ${active ? activeClassName : inactiveClassName}`}
    >
      {label}
    </Link>
  );
}
