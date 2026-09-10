import { updateCustomerLogin } from "@/server/org-actions";
import { PendingButton } from "@/components/pending-button";

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";
const overline = "font-mono text-[11px] uppercase tracking-[0.06em] text-stone-400";

/**
 * 고객사 담당자 로그인: 허용 도메인을 켜면 그 도메인의 Google 계정이 SSO 로 들어와
 * 이 고객사 소속 조회 계정이 된다(자기 고객사 알람만 보고, 처리는 못 한다).
 * 승인 정책(AUTH_AUTO_APPROVE)은 내부 인원과 같다.
 */
export function CustomerLoginEditor({
  customer,
  back,
}: {
  customer: { id: string; name: string; loginDomains: string | null };
  back: string;
}) {
  const on = Boolean(customer.loginDomains);
  return (
    <section className="border border-stone-200 bg-white">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-stone-200 px-5 py-3">
        <h2 className={overline}>담당자 로그인</h2>
        <span className="text-xs text-stone-400">
          {on
            ? `${customer.loginDomains} 계정이 로그인하면 ${customer.name} 알람만 조회하는 계정이 됩니다`
            : "꺼짐 — 이 고객사 사람은 로그인할 수 없습니다"}
        </span>
      </div>
      <form action={updateCustomerLogin} className="flex flex-wrap items-end gap-2 p-5 text-sm">
        <input type="hidden" name="customerId" value={customer.id} />
        <input type="hidden" name="back" value={back} />
        <label className="block w-80">
          <span className={`mb-1 block ${overline}`}>허용 로그인 도메인 (쉼표 구분)</span>
          <input
            name="loginDomains"
            defaultValue={customer.loginDomains ?? ""}
            placeholder="homenic.co.kr"
            className={`${control} w-full font-mono`}
          />
        </label>
        <PendingButton
          pendingLabel="저장 중…"
          className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700"
        >
          저장
        </PendingButton>
        <span className="basis-full text-xs text-stone-400">
          처음 로그인한 담당자는 가입 승인 대기에 “고객사 · {customer.name}” 표시로 올라옵니다(자동 승인이 켜져 있으면 바로 활성).
          도메인을 비우면 이미 발급된 세션도 즉시 막힙니다.
        </span>
      </form>
    </section>
  );
}
