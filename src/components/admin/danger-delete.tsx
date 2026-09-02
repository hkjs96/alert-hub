import { PendingButton } from "@/components/pending-button";

/**
 * 파괴적 삭제의 2단계 확인 (M3). 원클릭 삭제는 cascade로 하위 전체를
 * 조용히 지운다 — JS 없이 <details>로 "정말 삭제"를 한 번 더 펼치게 한다.
 */
export function DangerDelete({
  action,
  id,
  back,
  subject,
  impact,
}: {
  action: (formData: FormData) => void | Promise<void>;
  id: string;
  back?: string;
  /** 지워지는 것의 이름 ("네오위즈 고객사"). */
  subject: string;
  /** 함께 사라지는 것 ("프로젝트 2개·서비스 5개와 계정 매핑"). */
  impact?: string;
}) {
  return (
    <details className="relative inline-block text-left">
      <summary className="cursor-pointer list-none text-xs text-stone-400 hover:text-[#b42318] [&::-webkit-details-marker]:hidden">
        삭제
      </summary>
      <div className="absolute right-0 top-6 z-10 w-72 border border-stone-300 bg-white p-3.5 shadow-[0_18px_44px_rgba(27,26,23,0.18)]">
        <p className="text-xs leading-relaxed text-stone-600">
          <span className="font-semibold text-stone-900">{subject}</span>을(를)
          삭제합니다.
          {impact ? (
            <>
              {" "}
              <span className="text-[#b42318]">{impact}</span>도 함께 삭제되며
              되돌릴 수 없습니다.
            </>
          ) : (
            " 되돌릴 수 없습니다."
          )}
        </p>
        <form action={action} className="mt-2.5">
          <input type="hidden" name="id" value={id} />
          {back ? <input type="hidden" name="back" value={back} /> : null}
          <PendingButton
            pendingLabel="삭제 중…"
            className="inline-flex h-[26px] items-center border border-[#b42318] bg-[#b42318] px-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#7a1710]"
          >
            정말 삭제
          </PendingButton>
        </form>
      </div>
    </details>
  );
}
