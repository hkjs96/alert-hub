import Link from "next/link";
import { NavTab } from "@/components/nav-tab";

const TAB_BASE = "py-3 font-medium";
const TAB_ACTIVE = "font-semibold text-stone-900 shadow-[inset_0_-2px_0_#1b1a17]";
const TAB_IDLE = "text-stone-500 hover:text-stone-900";

/**
 * 등록관리 — the surfaces where organisation and people are decided, kept
 * apart from 모니터링. The split matters: 조직 · 담당자 관리 answers "who
 * belongs here", 알람 처리 순서 answers "who gets called first", and 멤버 관리
 * is the person master both draw from.
 *
 * v2: 페이지 타이틀 + 잉크 밑줄 탭 줄 (alert-hub v2.dc.html 04/05 프레임).
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="border-b border-stone-200">
        <h1 className="text-[27px] font-semibold leading-tight tracking-[-0.025em] text-stone-900">
          등록 관리
        </h1>
        <nav className="mt-4 flex gap-6 text-[13px]">
          <NavTab
            href="/admin/org"
            label="조직 · 담당자 관리"
            pattern="^/admin(?!/(escalation|contacts|silences))"
            className={TAB_BASE}
            activeClassName={TAB_ACTIVE}
            inactiveClassName={TAB_IDLE}
          />
          <NavTab
            href="/admin/escalation"
            label="알람 처리 순서"
            pattern="^/admin/escalation"
            className={TAB_BASE}
            activeClassName={TAB_ACTIVE}
            inactiveClassName={TAB_IDLE}
          />
          <NavTab
            href="/admin/silences"
            label="점검 · 뮤트"
            pattern="^/admin/silences"
            className={TAB_BASE}
            activeClassName={TAB_ACTIVE}
            inactiveClassName={TAB_IDLE}
          />
          <NavTab
            href="/admin/contacts"
            label="멤버 관리"
            pattern="^/admin/contacts"
            className={TAB_BASE}
            activeClassName={TAB_ACTIVE}
            inactiveClassName={TAB_IDLE}
          />
          <Link
            href="/"
            className="ml-auto py-3 text-stone-400 hover:text-stone-900"
          >
            ← 대시보드
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
