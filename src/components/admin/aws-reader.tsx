import { prisma } from "@/lib/prisma";
import { READER_ROLE_NAME } from "@/lib/aws/graph";
import { STACK_NAME } from "@/lib/aws/connect";
import { appUrl } from "@/lib/app-url";
import { hubRoleArn } from "@/server/aws";
import { cfnTemplateUrl, ensureConnectSecrets } from "@/server/connect";
import { checkConnection, saveReaderRole } from "@/server/aws-actions";
import { ConnectForm } from "@/components/admin/aws-connect-form";
import { PendingButton } from "@/components/pending-button";

const btn =
  "inline-flex h-8 items-center border border-stone-300 bg-white px-3 text-xs font-medium text-stone-900 hover:border-stone-500";

const REGIONS = ["ap-northeast-2", "ap-northeast-1", "us-east-1", "us-west-2", "ap-southeast-1", "eu-west-1"];

function fmt(d: Date | null): string {
  return d ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(d) : "";
}

/**
 * 계정 매핑 한 줄 아래의 "AWS 연결". 기본은 버튼 하나 — CloudFormation 빠른 생성 화면이 값이 다 채워진
 * 채로 열리고, 고객사 계정에서 "스택 생성"만 누르면 SNS 구독(전용 주소) + 그래프 읽기 역할이 생긴다.
 * 역할이 생기면 이 패널이 열릴 때 자동으로 연결을 확인한다. 손으로 하는 방법은 접어 둔다.
 */
export async function AwsReaderPanel({
  accountMapId,
  back,
  probe,
  error,
}: {
  accountMapId: string;
  back: string;
  probe?: boolean;
  error?: string | null;
}) {
  const map = await prisma.awsAccountMap.findUnique({
    where: { id: accountMapId },
    select: {
      accountId: true,
      readerRoleArn: true,
      readerCheckedAt: true,
      readerError: true,
      service: { select: { project: { select: { customer: { select: { id: true, name: true } } } } } },
    },
  });
  if (!map) return null;
  const customer = map.service.project.customer;
  const secrets = await ensureConnectSecrets(customer.id);
  const hub = hubRoleArn();
  const templateReady = Boolean(cfnTemplateUrl());
  const verified = Boolean(map.readerRoleArn && map.readerCheckedAt && !map.readerError);
  // 역할은 정해졌는데 아직 확인이 안 됐으면(방금 스택을 만든 경우 등) 열 때 자동으로 확인한다.
  const autoProbe = probe || Boolean(map.readerRoleArn && !verified);
  const status = verified
    ? { tone: "text-emerald-700", label: `연결됨 · ${fmt(map.readerCheckedAt)} 확인` }
    : map.readerError
      ? { tone: "text-[#b54708]", label: "그래프 연결 실패 — 스택이 끝났는지 확인 후 ③ 다시" }
      : map.readerRoleArn
        ? { tone: "text-stone-500", label: "스택 생성 후 ③ 연결 확인을 누르세요" }
        : { tone: "text-stone-400", label: "아직 연결 안 함 — 아래 ①②③ 순서대로" };
  const ingestUrl = `${appUrl() ?? "<APP_URL>"}/api/webhooks/cloudwatch?token=${secrets.ingestToken}`;
  const sep = back.includes("?") ? "&" : "?";

  const trust = JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: hub ?? "<AWS_ROLE_ARN 미설정>" },
          Action: "sts:AssumeRole",
          Condition: { StringEquals: { "sts:ExternalId": secrets.awsExternalId } },
        },
      ],
    },
    null,
    2,
  );
  const perms = JSON.stringify(
    { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["cloudwatch:GetMetricWidgetImage", "ec2:DescribeTags"], Resource: "*" }] },
    null,
    2,
  );

  return (
    <details id={`aws-${accountMapId}`} open={autoProbe || Boolean(error) || !verified} className="mt-1 border border-stone-200 bg-stone-50/60">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs">
        <span className="font-medium text-stone-700">🔗 AWS 연결 (알람 수신 · 그래프)</span>
        <span className={status.tone}>{status.label}</span>
      </summary>
      <div className="space-y-3 border-t border-stone-200 px-3 py-3 text-xs text-stone-600">
        {error ? <p className="border border-[#f3d9b8] bg-[#fdf6ec] px-2.5 py-1.5 text-[#b54708]">{error}</p> : null}

        <ConnectForm
          accountMapId={accountMapId}
          accountId={map.accountId}
          regions={REGIONS}
          stackName={STACK_NAME}
          notReady={!templateReady || !hub ? `${!hub ? "AWS_ROLE_ARN " : ""}${!templateReady ? "CFN_TEMPLATE_URL" : ""}` : null}
        />

        <form action={checkConnection} className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
          <input type="hidden" name="accountMapId" value={accountMapId} />
          <input type="hidden" name="back" value={back} />
          <span className="font-semibold text-stone-800">③ 스택이 CREATE_COMPLETE 가 되면</span>
          <PendingButton pendingLabel="확인 중…" className={btn}>연결 확인</PendingButton>
          <span className="text-stone-400">그래프 역할이 실제로 동작하는지 빈 그래프 한 장을 받아 봅니다.</span>
        </form>

        {autoProbe && map.readerRoleArn ? (
          <div>
            <div className="mb-1 font-semibold text-stone-800">그래프 연결 확인</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/aws/probe/${accountMapId}?t=${Date.now()}`} alt="연결 확인 결과" className="max-w-full border border-stone-200 bg-white" />
            <p className="mt-1 text-stone-400">
              그래프 칸(빈 축이어도)이 보이면 연결된 것입니다. 스택을 방금 만들었다면 1~2분 뒤{" "}
              <a href={`${back}${sep}probe=${accountMapId}#aws-${accountMapId}`} className="underline">다시 확인</a>.
            </p>
          </div>
        ) : null}

        <details className="border-t border-stone-200 pt-2">
          <summary className="cursor-pointer select-none text-stone-500">수동으로 하기 (CloudFormation 을 못 쓰는 경우)</summary>
          <div className="mt-2 space-y-3">
            <div>
              <div className="mb-1 font-semibold text-stone-800">이 고객사 전용 수신 주소 (SNS 구독 HTTPS 엔드포인트)</div>
              <code className="block select-all break-all border border-stone-200 bg-white px-2 py-1.5 font-mono text-[11px] text-stone-900">{ingestUrl}</code>
            </div>
            <div>
              <div className="mb-1 font-semibold text-stone-800">
                그래프 역할 <span className="font-mono">{READER_ROLE_NAME}</span> (IAM › 역할 › 사용자 지정 신뢰 정책 → 왼쪽, 인라인 정책 → 오른쪽)
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <pre className="select-all overflow-x-auto border border-stone-200 bg-white p-2 font-mono text-[11px] leading-4 text-stone-800">{trust}</pre>
                <pre className="select-all overflow-x-auto border border-stone-200 bg-white p-2 font-mono text-[11px] leading-4 text-stone-800">{perms}</pre>
              </div>
            </div>
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
                역할 ARN 저장
              </PendingButton>
            </form>
            <p className="text-stone-400">
              원클릭을 쓰려면 템플릿 <a href="/cfn/alert-hub-connect.yaml" className="underline">alert-hub-connect.yaml</a> 을 메가존 계정 S3 에 한 번
              올리고(공개 읽기), 그 주소를 Vercel 환경변수 <span className="font-mono">CFN_TEMPLATE_URL</span> 로 넣으세요.
            </p>
          </div>
        </details>
      </div>
    </details>
  );
}
