import { prisma } from "@/lib/prisma";
import { READER_ROLE_NAME } from "@/lib/aws/graph";
import { hubRoleArn } from "@/server/aws";
import { issueExternalId, saveReaderRole } from "@/server/aws-actions";
import { PendingButton } from "@/components/pending-button";

const btn =
  "inline-flex h-8 items-center border border-stone-300 bg-white px-3 text-xs font-medium text-stone-900 hover:border-stone-500";

function fmt(d: Date | null): string {
  return d ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(d) : "";
}

/**
 * 계정 매핑 한 줄 아래의 "그래프 연결" — 고객사 계정에 만들 역할의 신뢰 정책을 실제 값으로 채워 보여 주고,
 * 역할 ARN 을 받아 저장하고, 연결 확인(빈 그래프 한 장)을 그 자리에서 보여 준다.
 */
export async function AwsReaderPanel({
  accountMapId,
  back,
  probe,
  error,
}: {
  accountMapId: string;
  back: string;
  /** ?probe=<id> 로 들어오면 연결 확인 이미지를 그린다. */
  probe?: boolean;
  /** 저장 거부 사유(?awsErr=). */
  error?: string | null;
}) {
  const map = await prisma.awsAccountMap.findUnique({
    where: { id: accountMapId },
    select: {
      accountId: true,
      readerRoleArn: true,
      readerCheckedAt: true,
      readerError: true,
      service: { select: { project: { select: { customer: { select: { id: true, name: true, awsExternalId: true } } } } } },
    },
  });
  if (!map) return null;
  const customer = map.service.project.customer;
  const hub = hubRoleArn();
  const status = !map.readerRoleArn
    ? { tone: "text-stone-400", label: "그래프 미연결" }
    : map.readerError
      ? { tone: "text-[#b54708]", label: "연결 실패" }
      : map.readerCheckedAt
        ? { tone: "text-emerald-700", label: `연결됨 · ${fmt(map.readerCheckedAt)} 확인` }
        : { tone: "text-stone-500", label: "역할 저장됨 · 연결 확인 전" };

  const trust = JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: hub ?? "<AWS_ROLE_ARN 미설정 — Vercel 환경변수에 안내 데스크 역할 ARN>" },
          Action: "sts:AssumeRole",
          Condition: { StringEquals: { "sts:ExternalId": customer.awsExternalId ?? "<먼저 ExternalId 발급>" } },
        },
      ],
    },
    null,
    2,
  );
  const perms = JSON.stringify(
    { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "cloudwatch:GetMetricWidgetImage", Resource: "*" }] },
    null,
    2,
  );
  const sep = back.includes("?") ? "&" : "?";

  return (
    <details id={`aws-${accountMapId}`} open={probe || Boolean(error)} className="mt-1 border border-stone-200 bg-stone-50/60">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs">
        <span className="font-medium text-stone-700">📈 그래프 연결</span>
        <span className={status.tone}>{status.label}</span>
      </summary>
      <div className="space-y-3 border-t border-stone-200 px-3 py-3 text-xs text-stone-600">
        {error ? <p className="border border-[#f3d9b8] bg-[#fdf6ec] px-2.5 py-1.5 text-[#b54708]">{error}</p> : null}
        {!hub ? (
          <p className="border border-[#f3d9b8] bg-[#fdf6ec] px-2.5 py-1.5 text-[#b54708]">
            Vercel 환경변수 <code className="font-mono">AWS_ROLE_ARN</code>(안내 데스크 역할)이 없습니다. 먼저 넣고 재배포하세요.
          </p>
        ) : null}

        <div>
          <div className="mb-1 font-semibold text-stone-800">1. 고객사 ExternalId ({customer.name})</div>
          {customer.awsExternalId ? (
            <code className="select-all font-mono text-stone-900">{customer.awsExternalId}</code>
          ) : (
            <form action={issueExternalId} className="flex items-center gap-2">
              <input type="hidden" name="customerId" value={customer.id} />
              <input type="hidden" name="back" value={back} />
              <PendingButton pendingLabel="발급 중…" className={btn}>
                ExternalId 발급
              </PendingButton>
              <span className="text-stone-400">고객사마다 하나. 같은 고객사의 모든 계정이 같은 값을 씁니다.</span>
            </form>
          )}
        </div>

        <div>
          <div className="mb-1 font-semibold text-stone-800">
            2. 계정 <span className="font-mono">{map.accountId}</span> 에 역할 <span className="font-mono">{READER_ROLE_NAME}</span> 만들기
          </div>
          <p className="mb-1 text-stone-500">IAM › 역할 › 생성 › 사용자 지정 신뢰 정책 → 아래 그대로 붙여넣기 → 이름 {READER_ROLE_NAME} → 생성 → 권한 탭 › 인라인 정책(JSON)에 두 번째 블록.</p>
          <div className="grid gap-2 md:grid-cols-2">
            <pre className="overflow-x-auto border border-stone-200 bg-white p-2 font-mono text-[11px] leading-4 text-stone-800 select-all">{trust}</pre>
            <pre className="overflow-x-auto border border-stone-200 bg-white p-2 font-mono text-[11px] leading-4 text-stone-800 select-all">{perms}</pre>
          </div>
          <p className="mt-1 text-stone-400">철회: 이 역할을 지우면 그래프만 멈춥니다. 알람 수신(SNS)은 그대로입니다.</p>
        </div>

        <div>
          <div className="mb-1 font-semibold text-stone-800">3. 역할 ARN 저장 · 연결 확인</div>
          <form action={saveReaderRole} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="accountMapId" value={accountMapId} />
            <input type="hidden" name="back" value={back} />
            <input
              name="roleArn"
              defaultValue={map.readerRoleArn ?? ""}
              placeholder={`arn:aws:iam::${map.accountId}:role/${READER_ROLE_NAME}`}
              className="h-8 w-[26rem] max-w-full border border-stone-300 bg-white px-2 font-mono text-[11px]"
            />
            <PendingButton pendingLabel="저장 중…" className={btn}>
              저장
            </PendingButton>
            {map.readerRoleArn ? (
              <a href={`${back}${sep}probe=${accountMapId}#aws-${accountMapId}`} className={btn}>
                연결 확인
              </a>
            ) : null}
          </form>
          {map.readerError && !probe ? <p className="mt-1 text-[#b54708]">마지막 확인 실패: {map.readerError}</p> : null}
          {probe ? (
            <div className="mt-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/aws/probe/${accountMapId}?t=${Date.now()}`}
                alt="연결 확인 결과"
                className="max-w-full border border-stone-200 bg-white"
              />
              <p className="mt-1 text-stone-400">그래프 칸(데이터가 없으면 빈 축)이 보이면 연결 성공입니다. 결과는 이 계정 상태에 저장됩니다.</p>
            </div>
          ) : null}
        </div>
      </div>
    </details>
  );
}
