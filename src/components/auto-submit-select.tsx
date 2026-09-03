"use client";

/**
 * 바꾸는 즉시 폼을 제출하는 select (대시보드 필터). JS-free 원칙의 표시
 * 강화 예외 — JS가 없으면 평범한 select로 남고 "적용" 버튼이 제출한다.
 * 그래서 폼에는 여전히 submit 버튼이 있어야 한다.
 */
export function AutoSubmitSelect({
  onChange,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      onChange={(e) => {
        onChange?.(e);
        e.currentTarget.form?.requestSubmit();
      }}
    />
  );
}
