import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-4 border-b border-slate-200 pb-3 text-sm">
        <span className="font-semibold text-slate-900">관리</span>
        <Link href="/admin/customers" className="text-slate-600 hover:text-blue-600">
          고객사
        </Link>
        <Link href="/admin/contacts" className="text-slate-600 hover:text-blue-600">
          연락처(인원)
        </Link>
        <Link href="/" className="ml-auto text-slate-400 hover:text-blue-600">
          ← 대시보드
        </Link>
      </nav>
      {children}
    </div>
  );
}
