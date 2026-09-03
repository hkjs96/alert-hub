import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  createContact,
  deleteContact,
  updateContact,
} from "@/server/org-actions";
import { PendingButton } from "@/components/pending-button";

export const dynamic = "force-dynamic";

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";
const overline =
  "font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400";

/** 통지 채널 배지 (M5): 이 사람에게 실제로 닿을 수 있는 수단. */
function ChannelBadges({
  c,
}: {
  c: { slackId: string | null; email: string | null; phone: string | null };
}) {
  const chans = [
    c.slackId ? "Slack" : null,
    c.email ? "메일" : null,
    c.phone ? "전화" : null,
  ].filter(Boolean);
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
          key={ch}
          className="inline-flex h-[19px] items-center border border-stone-200 bg-stone-100 px-1.5 font-mono text-[11px] text-stone-500"
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

/** 배정 스코프의 사람 읽는 이름. */
function scopeLabel(a: {
  customer: { name: string } | null;
  project: { name: string; customer: { name: string } } | null;
  service: {
    name: string;
    project: { name: string; customer: { name: string } };
  } | null;
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

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { q?: string; customer?: string };
}) {
  const q = searchParams.q?.trim() || undefined;
  const customerFilter = searchParams.customer || undefined;

  const [contacts, customers] = await Promise.all([
    prisma.contact.findMany({
      orderBy: { name: "asc" },
      where: {
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { department: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(customerFilter === "internal"
          ? { customerId: null }
          : customerFilter
            ? { customerId: customerFilter }
            : {}),
      },
      include: {
        customer: true,
        assignments: {
          include: {
            customer: { select: { name: true } },
            project: {
              select: { name: true, customer: { select: { name: true } } },
            },
            service: {
              select: {
                name: true,
                project: {
                  select: { name: true, customer: { select: { name: true } } },
                },
              },
            },
            account: {
              select: {
                accountId: true,
                service: {
                  select: {
                    name: true,
                    project: {
                      select: { name: true, customer: { select: { name: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.customer.findMany({ orderBy: { name: "asc" } }),
  ]);

  const filtered = q || customerFilter;

  return (
    <div className="space-y-[18px]">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-stone-900">
          멤버 관리
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          전체 인원 마스터 — 고객사 담당자와 내부(MSP) 엔지니어를 함께 관리합니다.
          연락 수단(Slack·메일·전화)이 하나도 없는 인원에게는 통지가 발송되지
          않습니다.
        </p>
      </div>

      <section className="border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-4 py-3">
          <h2 className={overline}>새 인원 등록</h2>
        </div>
        <form action={createContact} className="flex flex-wrap items-end gap-2 p-4 text-sm">
          {([
            { name: "name", label: "이름", required: true, w: "w-28" },
            { name: "department", label: "부서", w: "w-28" },
            { name: "email", label: "이메일", type: "email", w: "w-48" },
            { name: "slackId", label: "Slack 멤버 ID", ph: "U0123ABC", w: "w-36" },
            { name: "phone", label: "전화 (E.164)", ph: "+8210…", w: "w-36" },
          ] as { name: string; label: string; required?: boolean; type?: string; ph?: string; w: string }[]).map((fld) => (
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
                className={`${control} w-full`}
              />
            </label>
          ))}
          <label className="block w-40">
            <span className={`mb-1 block ${overline}`}>소속</span>
            <select name="customerId" defaultValue="" className={`${control} w-full`}>
              <option value="">내부(자사)</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <PendingButton
            pendingLabel="등록 중…"
            className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700"
          >
            + 인원 등록
          </PendingButton>
        </form>
      </section>

      <form method="get" className="flex flex-wrap items-center gap-1.5 text-sm">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="검색 (이름·이메일·부서)"
          aria-label="검색"
          className={`${control} w-56`}
        />
        <select
          name="customer"
          aria-label="소속 필터"
          defaultValue={customerFilter ?? ""}
          className={control}
        >
          <option value="">소속 전체</option>
          <option value="internal">내부(자사)</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="inline-flex h-8 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50">
          적용
        </button>
        {filtered && (
          <Link href="/admin/contacts" className="text-xs font-medium text-indigo-600 hover:underline">
            ✕ 초기화
          </Link>
        )}
        <span className="ml-auto text-xs text-stone-500">
          <span className="font-mono font-bold text-stone-900">{contacts.length}</span>명
        </span>
      </form>

      <section className="border border-stone-200 bg-white">
        <div className="grid grid-cols-[1fr_130px_110px_170px_70px_60px] gap-3 border-b border-stone-200 px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400">
          <span>이름</span>
          <span>소속</span>
          <span>부서</span>
          <span>통지 채널</span>
          <span>배정</span>
          <span />
        </div>
        {contacts.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-stone-400">
            {filtered ? "조건에 맞는 인원이 없습니다." : "아직 등록된 인원이 없습니다."}
          </p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {contacts.map((c) => (
              <li key={c.id}>
                <details className="group">
                  <summary className="grid cursor-pointer list-none grid-cols-[1fr_130px_110px_170px_70px_60px] items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-stone-50 [&::-webkit-details-marker]:hidden">
                    <span className="font-medium text-stone-900">{c.name}</span>
                    <span className="text-sm text-stone-500">
                      {c.customer?.name ?? "내부"}
                    </span>
                    <span className="text-sm text-stone-500">
                      {c.department ?? "—"}
                    </span>
                    <ChannelBadges c={c} />
                    <span className="font-mono text-sm text-stone-600">
                      {c.assignments.length}
                    </span>
                    <span className="text-right text-xs text-stone-400 group-open:hidden">
                      수정 ▾
                    </span>
                  </summary>

                  <div className="space-y-4 border-t border-stone-100 bg-stone-50 px-4 py-4">
                    <form
                      action={updateContact}
                      className="flex flex-wrap items-end gap-2 text-sm"
                    >
                      <input type="hidden" name="id" value={c.id} />
                      {([
                        { name: "name", label: "이름", value: c.name, required: true, w: "w-28" },
                        { name: "department", label: "부서", value: c.department, w: "w-28" },
                        { name: "email", label: "이메일", value: c.email, type: "email", w: "w-48" },
                        { name: "slackId", label: "Slack 멤버 ID", value: c.slackId, w: "w-36" },
                        { name: "phone", label: "전화", value: c.phone, w: "w-36" },
                      ] as { name: string; label: string; value?: string | null; required?: boolean; type?: string; w: string }[]).map((fld) => (
                        <label key={fld.name} className={`block ${fld.w}`}>
                          <span className={`mb-1 block ${overline}`}>{fld.label}</span>
                          <input
                            name={fld.name}
                            type={fld.type ?? "text"}
                            required={fld.required}
                            defaultValue={fld.value ?? ""}
                            className={`${control} w-full`}
                          />
                        </label>
                      ))}
                      <label className="block w-40">
                        <span className={`mb-1 block ${overline}`}>소속</span>
                        <select
                          name="customerId"
                          defaultValue={c.customerId ?? ""}
                          className={`${control} w-full`}
                        >
                          <option value="">내부(자사)</option>
                          {customers.map((cu) => (
                            <option key={cu.id} value={cu.id}>
                              {cu.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <PendingButton
                        pendingLabel="저장 중…"
                        className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700"
                      >
                        저장
                      </PendingButton>
                    </form>
                    {c.assignments.length > 0 && c.customerId ? (
                      <p className="text-xs text-stone-400">
                        배정이 남아 있는 동안 소속은 내부로만 변경할 수 있습니다.
                      </p>
                    ) : null}

                    <div>
                      <div className={`mb-1.5 ${overline}`}>배정된 스코프</div>
                      {c.assignments.length === 0 ? (
                        <p className="text-xs text-stone-400">배정 없음</p>
                      ) : (
                        <ul className="space-y-1 text-sm text-stone-600">
                          {c.assignments.map((a) => (
                            <li key={a.id}>· {scopeLabel(a)}</li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <form
                      action={deleteContact}
                      className="flex items-center gap-2 border-t border-stone-200 pt-3"
                    >
                      <input type="hidden" name="id" value={c.id} />
                      <PendingButton
                        pendingLabel="삭제 중…"
                        className="inline-flex h-[26px] items-center border border-stone-200 bg-white px-2.5 text-xs font-medium text-[#b42318] transition-colors hover:border-[#b42318]"
                      >
                        이 인원 삭제
                      </PendingButton>
                      <span className="text-xs text-stone-400">
                        {c.assignments.length > 0
                          ? `배정 ${c.assignments.length}곳에서도 함께 제거되고, 지난 알람의 스냅샷에는 이름만 남습니다.`
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
