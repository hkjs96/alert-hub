import Link from "next/link";
import { KvTable, RefLine, ToneLabel, btnPrimaryAccent, btnSecondary } from "@/components/auth/primitives";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { requestRoleUpgrade } from "@/server/auth-actions";
import { newRef } from "@/lib/auth/ref";
import { PendingButton } from "@/components/pending-button";

/**
 * 접근 거부 (A4 우측). 막다른 길에 항상 다음 행동을 둔다 — 돌아가기, 권한 요청.
 * 참조 코드는 서버 로그에 요청 화면·계정과 함께 남는다.
 */
export function AccessDenied({
  screen,
  currentRole,
  requiredRole,
  userName,
  pinged,
}: {
  screen: string;
  currentRole: Role;
  requiredRole: Role;
  userName: string;
  pinged?: string;
}) {
  const ref = newRef("RQ");
  console.warn(`[authz] ${ref} denied ${userName} (${currentRole}) → ${screen} needs ${requiredRole}`);
  return (
    <div className="mx-auto max-w-xl">
      <div className="border border-stone-200 bg-white px-[34px] py-8" style={{ borderLeft: "3px solid #b42318" }}>
        <ToneLabel tone="err">접근 거부</ToneLabel>
        <h1 className="mt-3.5 text-[20px] font-semibold leading-snug tracking-[-0.02em] text-stone-900">
          이 페이지를 볼 권한이 없습니다
        </h1>
        <p className="mt-2.5 text-[13px] leading-[1.65] text-[#4a4842]">
          {screen}은(는) {ROLE_LABELS[requiredRole]} 권한이 필요합니다. 현재 계정은 {ROLE_LABELS[currentRole]} 권한으로,
          {currentRole === "OPERATOR"
            ? " 담당 고객사의 알람 조회와 처리까지 가능합니다."
            : " 알람 조회만 가능합니다."}
        </p>
        <div className="mt-6">
          <KvTable
            rows={[
              { k: "요청 화면", v: screen },
              { k: "현재 권한", v: ROLE_LABELS[currentRole] },
              { k: "필요 권한", v: ROLE_LABELS[requiredRole] },
            ]}
          />
        </div>
        <div className="mt-[22px] flex flex-wrap items-center gap-2">
          <Link href="/" className={btnPrimaryAccent}>
            대시보드로 돌아가기
          </Link>
          <form action={requestRoleUpgrade}>
            <input type="hidden" name="role" value={requiredRole} />
            <input type="hidden" name="screen" value={screen} />
            <PendingButton pendingLabel="요청 중…" className={btnSecondary}>
              권한 요청
            </PendingButton>
          </form>
          {pinged === "sent" ? (
            <span className="text-xs text-[#067647]">관리자에게 요청을 보냈습니다.</span>
          ) : pinged === "cooldown" ? (
            <span className="text-xs text-stone-500">최근에 이미 요청했습니다. 잠시 후 다시 시도하세요.</span>
          ) : pinged === "nochannel" ? (
            <span className="text-xs text-stone-500">알림 채널이 없어 관리자에게 직접 말씀해 주세요.</span>
          ) : null}
        </div>
        <RefLine code={ref} />
      </div>
    </div>
  );
}
