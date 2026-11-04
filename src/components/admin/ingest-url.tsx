import { prisma } from "@/lib/prisma";
import { appUrl } from "@/lib/app-url";
import { issueIngestToken, revokeIngestToken } from "@/server/ingest-actions";
import { PendingButton } from "@/components/pending-button";

const btn = "inline-flex h-8 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-900 hover:border-stone-500";

/**
 * 고객사 전용 알람 수신 주소. SNS 구독(HTTPS 엔드포인트)에 이 주소를 넣으면, 이 주소로 온 알람은
 * 이 고객사 계정의 알람일 때만 받는다. 공용 주소보다 안전하고, 고객사 하나만 끊거나 바꿀 수 있다.
 */
export async function IngestUrlPanel({ customerId }: { customerId: string }) {
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { ingestToken: true } });
  if (!c) return null;
  const since = new Date(Date.now() - 7 * 86400_000);
  const rejected = await prisma.ingestRejection.count({ where: { customerId, createdAt: { gte: since } } });
  const base = appUrl() ?? "<APP_URL>";
  const url = c.ingestToken ? `${base}/api/webhooks/cloudwatch?token=${c.ingestToken}` : null;
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-stone-400">
        알람 수신 주소 <span className="font-normal text-stone-400">(SNS 구독 HTTPS 엔드포인트)</span>
      </h2>
      {url ? (
        <div className="space-y-2 text-sm">
          <code className="block select-all break-all border border-stone-200 bg-stone-50 px-2.5 py-2 font-mono text-xs text-stone-900">{url}</code>
          <p className="text-xs text-stone-500">
            이 주소로 온 알람은 이 고객사에 매핑된 계정의 알람일 때만 받습니다. 구독 확인도 이 고객사 계정의 SNS 주제만 수락합니다.
            {rejected ? <span className="text-[#b54708]"> · 최근 7일 거부 {rejected}건 (시스템 진단에서 확인)</span> : null}
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={issueIngestToken}>
              <input type="hidden" name="customerId" value={customerId} />
              <PendingButton pendingLabel="재발급 중…" className={btn}>재발급 (이전 주소 즉시 무효)</PendingButton>
            </form>
            <form action={revokeIngestToken}>
              <input type="hidden" name="customerId" value={customerId} />
              <PendingButton pendingLabel="끄는 중…" className={btn}>전용 주소 끄기</PendingButton>
            </form>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <form action={issueIngestToken}>
            <input type="hidden" name="customerId" value={customerId} />
            <PendingButton pendingLabel="발급 중…" className={btn}>전용 수신 주소 발급</PendingButton>
          </form>
          <span className="text-xs text-stone-400">
            지금은 공용 주소로 받습니다. 발급 후 SNS 구독의 엔드포인트를 전용 주소로 바꾸세요(새 구독 추가 → 확인됨 → 옛 구독 삭제).
          </span>
        </div>
      )}
    </section>
  );
}
