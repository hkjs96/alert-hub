import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createCustomer, deleteCustomer } from "@/server/org-actions";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    include: { projects: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">고객사</h1>
        <p className="mt-1 text-sm text-stone-500">
          테넌트의 뿌리. 사내 시스템은 &ldquo;내부&rdquo; 고객사로 등록하세요.
        </p>
      </div>

      <form
        action={createCustomer}
        className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white p-4 text-sm"
      >
        <input
          name="name"
          required
          placeholder="고객사 이름"
          className="rounded-md border border-stone-300 px-2 py-1"
        />
        <label className="flex items-center gap-1 text-stone-600">
          <input type="checkbox" name="isInternal" /> 내부(자사)
        </label>
        <button
          type="submit"
          className="rounded-md bg-stone-900 px-3 py-1 text-white hover:bg-stone-700"
        >
          + 고객사 등록
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="px-4 py-2 font-medium">이름</th>
              <th className="px-4 py-2 font-medium">프로젝트</th>
              <th className="px-4 py-2 font-medium">구분</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {customers.map((c: any) => (
              <tr key={c.id} className="hover:bg-stone-50">
                <td className="px-4 py-2">
                  <Link
                    href={`/admin/customers/${c.id}`}
                    className="font-medium text-stone-900 hover:text-indigo-600 hover:underline"
                  >
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-stone-500">{c.projects.length}개</td>
                <td className="px-4 py-2 text-stone-500">
                  {c.isInternal ? "내부" : "고객"}
                </td>
                <td className="px-4 py-2 text-right">
                  <form action={deleteCustomer} className="inline">
                    <input type="hidden" name="id" value={c.id} />
                    <button className="text-xs text-stone-400 hover:text-red-600">
                      삭제
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-stone-400">
                  아직 고객사가 없습니다. 위에서 등록하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
