import { prisma } from "@/lib/prisma";
import { createContact, deleteContact, updateContact } from "@/server/org-actions";
import { PendingButton } from "@/components/pending-button";
import { ROLE_LABELS, ROLES, STATUS_LABELS } from "@/lib/auth/roles";
import { ChannelVerifyPanel } from "@/components/admin/channel-verify";

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";
const overline =
  "font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400";

/** 통지 채널 배지 (M5): 이 사람에게 실제로 닿을 수 있는 수단. */
export function ChannelBadges({
  c,
}: {
  c: {
    slackId: string | null;
    email: string | null;
    phone: string | null;
    slackVerifiedAt?: Date | null;
    emailVerifiedAt?: Date | null;
    phoneVerifiedAt?: Date | null;
  };
}) {
  const chans = [
    c.slackId ? { label: "Slack", ok: Boolean(c.slackVerifiedAt) } : null,
    c.email ? { label: "메일", ok: Boolean(c.emailVerifiedAt) } : null,
    c.phone ? { label: "전화", ok: Boolean(c.phoneVerifiedAt) } : null,
  ].filter((x): x is { label: string; ok: boolean } => Boolean(x));
  if (chans.length === 0) {
    return (
      <span
        className="inline-flex items-center gap-1 font-mono text-[11px] font-bold tracking-[0.06em] text-[#b42318]"
        title="연락 수단이 없어 이 사람에게는 어떤 통지도 발송되지 않습니다"
      >
        ⚠ 통지 불가
      </span>
    );
  }
  return (
    <span className="flex gap-1">
      {chans.map((ch) => (
        <span
          key={ch.label}
          title={ch.ok ? "도달 확인됨" : "등록만 됨 — 도달 미확인"}
          className={`inline-flex h-[19px] items-center gap-1 border px-1.5 font-mono text-[11px] ${
            ch.ok ? "border-[#067647]/30 bg-[#f0f8f3] text-[#067647]" : "border-stone-200 bg-stone-100 text-stone-500"
          }`}
        >
          {ch.ok ? "✓" : "?"} {ch.label}
        </span>
      ))}
    </span>
  );
}

function scopeLabel(a: {
  customer: { name: string } | null;
  project: { name: string; customer: { name: string } } | null;
  service: { name: string; project: { name: string; customer: { name: string } } } | null;
  account: {
    accountId: string;
    service: { name: string; project: { name: string; customer: { name: string } } };
  } | null;
}): string {
  if (a.customer) return `${a.customer.name} (고객사 전체)`;
  if (a.project) return `${a.project.customer.name} › ${a.project.name}`;
  if (a.service)
    return `${a.service.project.customer.name} › ${a.service.project.name} › ${a.service.name}`;
  if (a.account)
    return `${a.account.service.project.customer.name} › … › 계정 ${a.account.accountId}`;
  return "(알 수 없는 스코프)";
}

type Field = { name: string; label: string; value?: string | null; required?: boolean; type?: string; ph?: string; w: string };

export async function ContactRoster({
  scope,
  back,
  q,
  customerFilter,
  vreq,
}: {
  scope: "all" | "internal" | { customerId: string };
  back: string;
  q?: string;
  customerFilter?: string;
  /** `?vreq=<channel>:<result>` — 확인 요청 결과 표시. */
  vreq?: string;
}) {
  const where =
    scope === "internal"
      ? { customerId: null }
      : scope === "all"
        ? {
            ...(q
              ? {
                  OR: [
                    { name: { contains: q, mode: "insensitive" as const } },
                    { email: { contains: q, mode: "insensitive" as const } },
                    { department: { contains: q, mode: "insensitive" as const } },
                  ],
                }
              : {}),
            ...(customerFilter === "internal"
              ? { customerId: null }
              : customerFilter
                ? { customerId: customerFilter }
                : {}),
          }
        : { customerId: scope.customerId };

  const [contacts, customers] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        customer: true,
        assignments: {
          include: {
            customer: { select: { name: true } },
            project: { select: { name: true, customer: { select: { name: true } } } },
            service: {
              select: {
                name: true,
                project: { select: { name: true, customer: { select: { name: true } } } },
              },
            },
            account: {
              select: {
                accountId: true,
                service: {
                  select: {
                    name: true,
                    project: { select: { name: true, customer: { select: { name: true } } } },
                  },
                },
              },
            },
          },
        },
        teamMemberships: { include: { team: { select: { name: true } } } },
        verifications: { orderBy: { sentAt: "desc" }, take: 5 },
      },
    }),
    scope === "all" ? prisma.customer.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);

  const fixedCustomerId =
    scope === "internal" ? "" : scope === "all" ? null : scope.customerId;

  const fields = (c?: { name: string; department: string | null; email: string | null; slackId: string | null; phone: string | null }): Field[] => [
    { name: "name", label: "이름", value: c?.name, required: true, w: "w-28" },
    { name: "department", label: "부서", value: c?.department, w: "w-28" },
    { name: "email", label: "이메일", value: c?.email, type: "email", w: "w-48" },
    { name: "slackId", label: "Slack 멤버 ID", value: c?.slackId, ph: "U0123ABC", w: "w-36" },
    { name: "phone", label: "전화 (E.164)", value: c?.phone, ph: "+8210…", w: "w-36" },
  ];

  const renderFields = (list: Field[]) =>
    list.map((fld) => (
      <label key={fld.name} className={`block ${fld.w}`}>
        <span className={`mb-1 block ${overline}`}>
          {fld.label}
          {fld.required ? "" : " (선택)"}
        </span>
        <input
          name={fld.name}
          type={fld.type ?? "text"}
          required={fld.required}
          placeholder={fld.ph}
          defaultValue={fld.value ?? ""}
          className={`${control} w-full`}
        />
      </label>
    ));

  const customerSelect = (current: string | null) =>
    fixedCustomerId !== null ? (
      <input type="hidden" name="customerId" value={fixedCustomerId} />
    ) : (
      <label className="block w-40">
        <span className={`mb-1 block ${overline}`}>소속</span>
        <select name="customerId" defaultValue={current ?? ""} className={`${control} w-full`}>
          <option value="">내부(자사)</option>
          {customers.map((cu) => (
            <option key={cu.id} value={cu.id}>
              {cu.name}
            </option>
          ))}
        </select>
      </label>
    );

  return (
    <div className="space-y-3">
      <form action={createContact} className="flex flex-wrap items-end gap-2 border border-stone-200 bg-white p-4 text-sm">
        <input type="hidden" name="back" value={back} />
        {renderFields(fields())}
        {customerSelect(null)}
        <PendingButton
          pendingLabel="등록 중…"
          className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700"
        >
          + 인원 등록
        </PendingButton>
      </form>

      <section className="border border-stone-200 bg-white">
        <div className="grid grid-cols-[1fr_130px_110px_170px_70px_60px] gap-3 border-b border-stone-200 px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400">
          <span>이름</span>
          <span>{scope === "all" ? "소속" : "팀"}</span>
          <span>부서</span>
          <span>통지 채널</span>
          <span>배정</span>
          <span />
        </div>
        {contacts.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-stone-400">
            {q || customerFilter ? "조건에 맞는 인원이 없습니다." : "아직 등록된 인원이 없습니다."}
          </p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {contacts.map((c) => (
              <li key={c.id}>
                <details className="group">
                  <summary className="grid cursor-pointer list-none grid-cols-[1fr_130px_110px_170px_70px_60px] items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-stone-50 [&::-webkit-details-marker]:hidden">
                    <span className={`font-medium ${c.active ? "text-stone-900" : "text-stone-400 line-through decoration-stone-300"}`}>
                      {c.name}
                      {!c.active ? (
                        <span className="ml-1.5 border border-stone-200 px-1 font-mono text-[11px] no-underline text-stone-400">
                          비활성
                        </span>
                      ) : null}
                      {c.customerId === null && c.status !== "ACTIVE" ? (
                        <span className={`ml-1.5 border px-1 font-mono text-[11px] ${c.status === "PENDING" ? "border-[#4a5568] text-[#4a5568]" : "border-stone-200 text-stone-400"}`}>
                          {STATUS_LABELS[c.status]}
                        </span>
                      ) : null}
                      {c.customerId === null && c.role === "ADMIN" ? (
                        <span className="ml-1.5 border border-[#e0dcd3] px-1 font-mono text-[11px] text-[#b54708]" title="관리자">
                          admin
                        </span>
                      ) : null}
                      {c.lastLoginAt ? (
                        <span className="ml-1.5 font-mono text-[11px] text-stone-400" title="SSO 로그인 이력 있음">
                          sso
                        </span>
                      ) : null}
                    </span>
                    <span className="truncate text-sm text-stone-500">
                      {scope === "all"
                        ? (c.customer?.name ?? "내부")
                        : c.teamMemberships.length
                          ? c.teamMemberships.map((m) => m.team.name).join(", ")
                          : "—"}
                    </span>
                    <span className="text-sm text-stone-500">{c.department ?? "—"}</span>
                    <ChannelBadges c={c} />
                    <span className="font-mono text-sm text-stone-600">{c.assignments.length}</span>
                    <span className="text-right text-xs text-stone-400 group-open:hidden">수정 ▾</span>
                  </summary>

                  <div className="space-y-4 border-t border-stone-100 bg-stone-50 px-4 py-4">
                    <form action={updateContact} className="flex flex-wrap items-end gap-2 text-sm">
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="back" value={back} />
                      {renderFields(fields(c))}
                      {customerSelect(c.customerId)}
                      {c.customerId === null ? (
                        <label className="block w-36">
                          <span className={`mb-1 block ${overline}`}>역할</span>
                          <select name="role" defaultValue={c.role} className={`${control} w-full`}>
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <label className="flex h-8 items-center gap-1.5 text-sm text-stone-700">
                        <input type="hidden" name="activeField" value="1" />
                        <input type="checkbox" name="active" defaultChecked={c.active} className="h-4 w-4" />
                        활성
                      </label>
                      {c.customerId === null ? (
                        <label className="flex h-8 items-center gap-1.5 text-sm text-stone-700" title="배정과 무관하게 모든 고객사의 알람을 봅니다 (관제·리드). 관리자는 항상 전체.">
                          <input type="hidden" name="seeAllField" value="1" />
                          <input type="checkbox" name="seeAll" defaultChecked={c.seeAll} className="h-4 w-4" />
                          전체 보기
                        </label>
                      ) : null}
                      <PendingButton
                        pendingLabel="저장 중…"
                        className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700"
                      >
                        저장
                      </PendingButton>
                    </form>
                    {!c.active ? (
                      <p className="text-xs text-stone-500">
                        비활성: 배정·팀 소속은 그대로지만 알람 순서 해석과 선택 목록에서 빠지고, SSO 로그인이 거부됩니다.
                        다시 활성으로 바꾸면 원래 자리로 돌아옵니다.
                      </p>
                    ) : null}
                    {scope === "all" && c.assignments.length > 0 && c.customerId ? (
                      <p className="text-xs text-stone-400">
                        배정이 남아 있는 동안 소속은 내부로만 변경할 수 있습니다.
                      </p>
                    ) : null}

                    <ChannelVerifyPanel c={c} back={back} vreq={vreq} />

                    <div>
                      <div className={`mb-1.5 ${overline}`}>배정된 스코프</div>
                      {c.assignments.length === 0 && c.teamMemberships.length === 0 ? (
                        <p className="text-xs text-stone-400">배정 없음</p>
                      ) : (
                        <ul className="space-y-1 text-sm text-stone-600">
                          {c.assignments.map((a) => (
                            <li key={a.id}>· {scopeLabel(a)}</li>
                          ))}
                          {c.teamMemberships.map((m) => (
                            <li key={m.id}>· 팀 {m.team.name}</li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <form action={deleteContact} className="flex items-center gap-2 border-t border-stone-200 pt-3">
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="back" value={back} />
                      <PendingButton
                        pendingLabel="삭제 중…"
                        className="inline-flex h-[26px] items-center border border-stone-200 bg-white px-2.5 text-xs font-medium text-[#b42318] transition-colors hover:border-[#b42318]"
                      >
                        이 인원 삭제
                      </PendingButton>
                      <span className="text-xs text-stone-400">
                        {c.assignments.length + c.teamMemberships.length > 0
                          ? `배정 ${c.assignments.length}곳·팀 ${c.teamMemberships.length}곳에서도 함께 제거되고, 지난 알람의 스냅샷에는 이름만 남습니다.`
                          : "지난 알람의 스냅샷에는 이름만 남습니다."}
                      </span>
                    </form>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
