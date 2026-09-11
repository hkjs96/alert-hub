import { updateCustomerLogin } from "@/server/org-actions";
import { PendingButton } from "@/components/pending-button";
import { GRANT_HINTS, GRANT_LABELS, PORTAL_GRANTS, describeGrants, parseGrants } from "@/lib/portal";

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";
const overline = "font-mono text-[11px] uppercase tracking-[0.06em] text-stone-400";

/**
 * 고객사 담당자 로그인 + 포털 권한. 허용 도메인을 켜면 그 도메인의 Google 계정이
 * SSO 로 들어와 이 고객사 소속 조회 계정이 된다. 권한 체크박스는 그 계정이
 * "고객사 설정" 화면에서 무엇을 고칠 수 있는지 — 기본은 전부 읽기 전용.
 */
export function CustomerLoginEditor({
  customer,
  back,
  variant = "section",
}: {
  customer: { id: string; name: string; loginDomains: string | null; portalGrants: string | null };
  back: string;
  /** "inline" 은 목록 행 안에 펼쳐 쓰는 형태 — 바깥 카드·제목 없이 폼만. */
  variant?: "section" | "inline";
}) {
  const on = Boolean(customer.loginDomains);
  const granted = parseGrants(customer.portalGrants);
  const form = (
      <form action={updateCustomerLogin} className={`space-y-4 text-sm ${variant === "section" ? "p-5" : "pt-3"}`}>
        <input type="hidden" name="customerId" value={customer.id} />
        <input type="hidden" name="back" value={back} />

        <label className="block w-80 max-w-full">
          <span className={`mb-1 block ${overline}`}>허용 로그인 도메인 (쉼표 구분)</span>
          <input
            name="loginDomains"
            defaultValue={customer.loginDomains ?? ""}
            placeholder="homenic.co.kr"
            className={`${control} w-full font-mono`}
          />
        </label>

        <fieldset>
          <legend className={`mb-1.5 ${overline}`}>이 고객사에 허용할 쓰기 (기본: 전부 읽기 전용)</legend>
          <div className="space-y-1.5">
            {PORTAL_GRANTS.map((g) => (
              <label key={g} className="flex cursor-pointer items-start gap-2 text-stone-800">
                <input
                  type="checkbox"
                  name="grant"
                  value={g}
                  defaultChecked={granted.includes(g)}
                  className="mt-0.5 h-4 w-4 accent-stone-900"
                />
                <span>
                  {GRANT_LABELS[g]}
                  <span className="ml-2 text-xs text-stone-400">{GRANT_HINTS[g]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <PendingButton
            pendingLabel="저장 중…"
            className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700"
          >
            저장
          </PendingButton>
          <span className="text-xs text-stone-400">
            담당 순서 · 팀 · 라우팅 규칙 · AWS 계정 매핑은 어떤 권한을 줘도 고객사가 바꿀 수 없습니다(MSP 전용).
            도메인을 비우면 이미 발급된 세션도 즉시 막힙니다.
          </span>
        </div>
      </form>
  );
  if (variant === "inline") return form;
  return (
    <section className="border border-stone-200 bg-white">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-stone-200 px-5 py-3">
        <h2 className={overline}>담당자 로그인 · 권한</h2>
        <span className="text-xs text-stone-400">
          {on
            ? `${customer.loginDomains} 계정이 로그인하면 ${customer.name} 알람만 조회 · ${describeGrants(customer.portalGrants)}`
            : "꺼짐 — 이 고객사 사람은 로그인할 수 없습니다"}
        </span>
      </div>
      {form}
    </section>
  );
}
