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
        <h1 className="text-xl font-semibold text-slate-900">연락처(인원)</h1>
        <p className="mt-1 text-sm text-slate-500">
          사람 마스터 — 한 번 등록하면 어느 고객사/프로젝트/서비스에든 드롭다운으로 배정할 수 있습니다.
        </p>
      </div>

      <form
        action={createContact}
        className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-4 text-sm"
      >
        <input
          name="name"
          required
          placeholder="이름"
          className="rounded-md border border-slate-300 px-2 py-1"
        />
        <input
          name="email"
          type="email"
          placeholder="이메일 (선택)"
          className="rounded-md border border-slate-300 px-2 py-1"
        />
        <input
          name="department"
          placeholder="부서 (선택)"
          className="rounded-md border border-slate-300 px-2 py-1"
        />
        <select
          name="customerId"
          className="rounded-md border border-slate-300 bg-white px-2 py-1"
          defaultValue=""
        >
          <option value="">내부(자사) 소속</option>
          {customers.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name} 소속
            </option>
          ))}
        </select>
        <button className="rounded-md bg-slate-900 px-3 py-1 text-white hover:bg-slate-700">
          + 인원 등록
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">이름</th>
              <th className="px-4 py-2 font-medium">소속</th>
              <th className="px-4 py-2 font-medium">부서</th>
              <th className="px-4 py-2 font-medium">이메일</th>
              <th className="px-4 py-2 font-medium">배정</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {contacts.map((c: any) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-medium text-slate-900">{c.name}</td>
                <td className="px-4 py-2 text-slate-500">
                  {c.customer?.name ?? "내부"}
                </td>
                <td className="px-4 py-2 text-slate-500">{c.department ?? "—"}</td>
                <td className="px-4 py-2 text-slate-500">{c.email ?? "—"}</td>
                <td className="px-4 py-2 text-slate-500">{c.assignments.length}곳</td>
                <td className="px-4 py-2 text-right">
                  <form action={deleteContact} className="inline">
                    <input type="hidden" name="id" value={c.id} />
                    <button className="text-xs text-slate-400 hover:text-red-600">
                      삭제
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
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
