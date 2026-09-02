import { prisma } from "@/lib/prisma";
import { createContact, deleteContact } from "@/server/org-actions";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const [contacts, customers] = await Promise.all([
    prisma.contact.findMany({
      orderBy: { name: "asc" },
      include: { customer: true, assignments: true },
    }),
    prisma.customer.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-stone-900">멤버 관리</h1>
        <p className="mt-1 text-sm text-stone-500">
          전체 인원 마스터 — 고객사 담당자와 내부(MSP) 엔지니어를 함께 관리합니다.
          한 번 등록하면 어느 고객사/프로젝트/서비스에든 드롭다운으로 배정할 수 있습니다.
        </p>
      </div>

      <form
        action={createContact}
        className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white p-4 text-sm"
      >
        <input
          name="name"
          required
          placeholder="이름"
          className="h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400"
        />
        <input
          name="email"
          type="email"
          placeholder="이메일 (선택)"
          className="h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400"
        />
        <input
          name="department"
          placeholder="부서 (선택)"
          className="h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400"
        />
        <select
          name="customerId"
          className="h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400"
          defaultValue=""
        >
          <option value="">내부(자사) 소속</option>
          {customers.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name} 소속
            </option>
          ))}
        </select>
        <button className="inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700">
          + 인원 등록
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="px-4 py-2 font-medium">이름</th>
              <th className="px-4 py-2 font-medium">소속</th>
              <th className="px-4 py-2 font-medium">부서</th>
              <th className="px-4 py-2 font-medium">이메일</th>
              <th className="px-4 py-2 font-medium">배정</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {contacts.map((c: any) => (
              <tr key={c.id} className="hover:bg-stone-50">
                <td className="px-4 py-2 font-medium text-stone-900">{c.name}</td>
                <td className="px-4 py-2 text-stone-500">
                  {c.customer?.name ?? "내부"}
                </td>
                <td className="px-4 py-2 text-stone-500">{c.department ?? "—"}</td>
                <td className="px-4 py-2 text-stone-500">{c.email ?? "—"}</td>
                <td className="px-4 py-2 text-stone-500">{c.assignments.length}곳</td>
                <td className="px-4 py-2 text-right">
                  <form action={deleteContact} className="inline">
                    <input type="hidden" name="id" value={c.id} />
                    <button className="text-xs text-stone-400 hover:text-[#b42318]">
                      삭제
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-stone-400">
                  아직 등록된 인원이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
