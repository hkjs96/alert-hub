import Link from "next/link";
import { redirect } from "next/navigation";
import { KvTable, ToneLabel, btnPrimaryInk, btnSecondary } from "@/components/auth/primitives";
import { PendingButton } from "@/components/pending-button";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { authMode, getCurrentUser, listAdmins } from "@/server/auth";
import { requestApprovalPing } from "@/server/auth-actions";

export const dynamic = "force-dynamic";

function fmt(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ") + "Z";
}

/**
 * 승인 대기 (A4 좌측). 계정은 만들어졌고 관리자 승인만 남은 상태. 막다른 길에
 * 다음 행동(알림 보내기·새로고침)을 두고, 60초마다 새로고침해 승인되면
 * 자동으로 넘어간다.
 */
export default async function PendingPage({ searchParams }: { searchParams: { pinged?: string } }) {
  if (authMode() === "open") redirect("/");
  const me = await getCurrentUser();
  if (!me) redirect("/login?next=/pending");
  if (me.status === "ACTIVE") redirect(me.onboardedAt ? "/" : "/welcome");
  const admins = await listAdmins();
  const cooldown = me.approvalPingAt && Date.now() - me.approvalPingAt.getTime() < 60 * 60 * 1000;

  return (
    <div className="w-[560px] max-w-full">
      <meta httpEquiv="refresh" content="60" />
      <div className="border border-stone-200 bg-white px-[34px] py-8" style={{ borderLeft: "3px solid #4a5568" }}>
        <ToneLabel tone="info">승인 대기</ToneLabel>
        <h1 className="mt-3.5 text-[20px] font-semibold leading-snug tracking-[-0.02em] text-stone-900">
          관리자 승인을 기다리고 있습니다
        </h1>
        <p className="mt-2.5 text-[13px] leading-[1.65] text-[#4a4842]">
          계정은 정상적으로 만들어졌습니다. 권한이 배정되면 이 페이지가 자동으로 넘어갑니다. 보통 영업일 기준 하루 안에
          처리됩니다.
        </p>
        <div className="mt-6">
          <KvTable
            rows={[
              { k: "이름", v: me.name },
              { k: "이메일", v: me.email, mono: true },
              { k: "요청 시각", v: fmt(me.createdAt), mono: true },
              { k: "요청 권한", v: ROLE_LABELS[me.role] },
            ]}
          />
        </div>
        <div className="mt-[22px] flex flex-wrap items-center gap-2">
          <form action={requestApprovalPing}>
            <PendingButton pendingLabel="보내는 중…" className={btnPrimaryInk} disabled={Boolean(cooldown)}>
              승인 요청 알림 보내기
            </PendingButton>
          </form>
          <Link href="/pending" className={btnSecondary}>
            상태 새로고침
          </Link>
          {searchParams.pinged === "sent" ? (
            <span className="text-xs text-[#067647]">관리자 채널로 알림을 보냈습니다.</span>
          ) : searchParams.pinged === "cooldown" || cooldown ? (
            <span className="text-xs text-stone-500">최근에 이미 보냈습니다 · 한 시간에 한 번</span>
          ) : searchParams.pinged === "nochannel" ? (
            <span className="text-xs text-stone-500">알림 채널이 없어 관리자에게 직접 말씀해 주세요.</span>
          ) : null}
        </div>
        <p className="mt-3.5 text-xs text-stone-400">
          승인 담당{" "}
          <span className="font-medium text-[#4a4842]">
            {admins.length ? admins.map((a) => a.name).join(", ") : "미지정"}
          </span>{" "}
          · 이 페이지는 승인되면 자동으로 이동합니다.
        </p>
      </div>
    </div>
  );
}
