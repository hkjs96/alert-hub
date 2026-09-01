import Link from "next/link";

/**
 * 등록관리 — the surfaces where organisation and people are decided, kept
 * apart from 모니터링. The split matters: 조직 · 담당자 관리 answers "who
 * belongs here", 알람 처리 순서 answers "who gets called first", and 멤버 관리
 * is the person master both draw from.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-4 border-b border-stone-200 pb-3 text-sm">
        <span className="font-semibold text-stone-900">등록관리</span>
        <Link href="/admin/customers" className="text-stone-600 hover:text-indigo-600">
          조직 · 담당자 관리
        </Link>
        <Link href="/admin/escalation" className="text-stone-600 hover:text-indigo-600">
          알람 처리 순서
        </Link>
        <Link href="/admin/contacts" className="text-stone-600 hover:text-indigo-600">
          멤버 관리
        </Link>
        <Link href="/" className="ml-auto text-stone-400 hover:text-indigo-600">
          ← 대시보드
        </Link>
      </nav>
      {children}
    </div>
  );
}
