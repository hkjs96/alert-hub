import { prisma } from "@/lib/prisma";
import { ROLE_HINTS, ROLE_LABELS, ROLES } from "@/lib/auth/roles";
import { approveAccount, rejectAccount } from "@/server/auth-actions";
import { PendingButton } from "@/components/pending-button";
import { ToneLabel } from "@/components/auth/primitives";

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";

function fmt(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ") + "Z";
}

/**
 * 가입 승인 대기 목록 — SSO로 처음 들어와 PENDING 인 내부 인원. 역할을 고르고
 * 승인하거나 거절한다. 비어 있으면 아무것도 그리지 않는다.
 */
export async function PendingApprovals() {
  const pending = await prisma.contact.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: { customer: { select: { name: true } } },
  });
  if (!pending.length) return null;
  return (
    <section id="pending" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-sm font-semibold text-stone-900">가입 승인 대기</h2>
        <span className="text-xs text-stone-400">SSO로 처음 로그인한 인원 · {pending.length}명</span>
      </div>
      <ul className="divide-y divide-stone-200 border border-[#4a5568] bg-white">
        {pending.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <ToneLabel tone="info">대기</ToneLabel>
            <span className="font-medium text-stone-900">{c.name}</span>
            {c.customer ? (
              <span className="border border-stone-900 px-1 font-mono text-[11px] text-stone-900" title="고객사 담당자 — 자기 고객사 알람만 조회">
                고객사 · {c.customer.name}
              </span>
            ) : null}
            <span className="font-mono text-xs text-stone-500">{c.email}</span>
            <span className="text-xs text-stone-400">요청 {fmt(c.createdAt)}</span>
            <span className="ml-auto flex items-center gap-1.5">
              <form action={approveAccount} className="flex items-center gap-1.5">
                <input type="hidden" name="id" value={c.id} />
                {c.customer ? (
                  <>
                    <input type="hidden" name="role" value="VIEWER" />
                    <span className="text-xs text-stone-500">조회 전용</span>
                  </>
                ) : (
                  <select name="role" defaultValue={c.role} className={control} aria-label="역할">
                    {ROLES.map((r) => (
                      <option key={r} value={r} title={ROLE_HINTS[r]}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                )}
                <PendingButton
                  pendingLabel="승인 중…"
                  className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white hover:bg-stone-700"
                >
                  승인
                </PendingButton>
              </form>
              <form action={rejectAccount}>
                <input type="hidden" name="id" value={c.id} />
                <PendingButton
                  pendingLabel="…"
                  className="inline-flex h-8 items-center rounded-md border border-stone-200 bg-white px-3 text-sm font-medium text-[#b42318] hover:border-[#b42318]"
                >
                  거절
                </PendingButton>
              </form>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-stone-400">
        {ROLES.map((r) => `${ROLE_LABELS[r]}: ${ROLE_HINTS[r]}`).join(" · ")}
      </p>
    </section>
  );
}
