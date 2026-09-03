import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ContactRoster } from "@/components/admin/contact-roster";

export const dynamic = "force-dynamic";

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";

/**
 * 전체 인원 목록 (고객사 담당자 + 내부 인원). 일상 관리는 조직 트리(고객사
 * 담당자)와 팀 페이지(내부 인원)에서 하고, 이 화면은 "누가 어디 있지?"를
 * 한 번에 찾는 검색 유틸리티로 남는다.
 */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { q?: string; customer?: string };
}) {
  const q = searchParams.q?.trim() || undefined;
  const customerFilter = searchParams.customer || undefined;
  const customers = await prisma.customer.findMany({ orderBy: { name: "asc" } });
  const back =
    "/admin/contacts" +
    (q || customerFilter
      ? "?" + new URLSearchParams({ ...(q ? { q } : {}), ...(customerFilter ? { customer: customerFilter } : {}) })
      : "");

  return (
    <div className="space-y-[18px]">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-stone-900">전체 인원</h1>
        <p className="mt-1 text-sm text-stone-500">
          고객사 담당자와 내부 인원을 한 번에 검색합니다. 고객사 담당자는{" "}
          <Link href="/admin/org" className="text-indigo-600 underline">조직 트리</Link>의 고객사 패널에서,
          내부 인원과 팀은 <Link href="/admin/teams" className="text-indigo-600 underline">팀 · 내부 인원</Link>에서 관리합니다.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-1.5 text-sm">
        <input type="search" name="q" defaultValue={q ?? ""} placeholder="검색 (이름·이메일·부서)" aria-label="검색" className={`${control} w-56`} />
        <select name="customer" aria-label="소속 필터" defaultValue={customerFilter ?? ""} className={control}>
          <option value="">소속 전체</option>
          <option value="internal">내부(자사)</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button className="inline-flex h-8 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50">적용</button>
        {(q || customerFilter) && (
          <Link href="/admin/contacts" className="text-xs font-medium text-indigo-600 hover:underline">✕ 초기화</Link>
        )}
      </form>

      <ContactRoster scope="all" back={back} q={q} customerFilter={customerFilter} />
    </div>
  );
}
