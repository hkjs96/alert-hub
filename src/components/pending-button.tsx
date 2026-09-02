"use client";

import { useFormStatus } from "react-dom";

/**
 * 제출 즉시 반응하는 버튼 (P4). 서버 액션 왕복 동안 비활성 + "처리 중…" —
 * JS-free 원칙의 유일한 예외로, 기능은 여전히 JS 없이 동작하고 이 컴포넌트는
 * 표시만 강화한다 (JS가 없으면 평범한 submit 버튼으로 동작).
 */
export function PendingButton({
  children,
  className,
  pendingLabel = "처리 중…",
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      {...rest}
      disabled={disabled || pending}
      className={`${className ?? ""} ${pending ? "cursor-wait opacity-60" : ""}`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
