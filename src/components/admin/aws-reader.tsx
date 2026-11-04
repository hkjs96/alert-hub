import { prisma } from "@/lib/prisma";
import { READER_ROLE_NAME } from "@/lib/aws/graph";
import { STACK_NAME } from "@/lib/aws/connect";
import { appUrl } from "@/lib/app-url";
import { hubRoleArn } from "@/server/aws";
import { cfnTemplateUrl, ensureConnectSecrets } from "@/server/connect";
import { connectAws, saveReaderRole } from "@/server/aws-actions";
import { PendingButton } from "@/components/pending-button";

const btn =
  "inline-flex h-8 items-center border border-stone-300 bg-white px-3 text-xs font-medium text-stone-900 hover:border-stone-500";
const primary =
  "inline-flex h-9 items-center bg-stone-900 px-4 text-sm font-semibold text-white hover:bg-black";

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
      ? { tone: "text-[#b54708]", label: "연결 안 됨 · 스택 생성 전이거나 실패" }
      : map.readerRoleArn
        ? { tone: "text-stone-500", label: "스택 생성 대기 · 확인 중" }
        : { tone: "text-stone-400", label: "미연결" };
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
    { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "cloudwatch:GetMetricWidgetImage", Resource: "*" }] },
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

        <form action={connectAws} className="space-y-2">
          <input type="hidden" name="accountMapId" value={accountMapId} />
          <input type="hidden" name="back" value={back} />
          <p className="text-stone-700">
            계정 <span className="font-mono font-semibold">{map.accountId}</span> 으로 AWS 콘솔에 <b>로그인한 상태</b>에서 누르세요.
            CloudFormation 화면이 값이 채워진 채로 열립니다 → 맨 아래 <b>IAM 리소스 생성 동의</b> 체크 → <b>스택 생성</b>. 끝.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-stone-500">리전</span>
              <select name="region" defaultValue="ap-northeast-2" className="h-8 border border-stone-300 bg-white px-2 text-xs">
                {REGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="block min-w-[18rem] flex-1">
              <span className="mb-1 block text-[11px] font-semibold text-stone-500">
                지금 쓰는 SNS 주제 ARN (선택 — 넣으면 그 주제에 구독만 추가, 경보는 그대로)
              </span>
              <input
                name="existingTopicArn"
                placeholder={`arn:aws:sns:ap-northeast-2:${map.accountId}:기존주제이름`}
                className="h-8 w-full border border-stone-300 bg-white px-2 font-mono text-[11px]"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 pb-1.5">
              <input type="checkbox" name="createRole" value="on" defaultChecked className="accent-stone-900" />
              그래프 역할도 만들기
              <input type="hidden" name="createRole" value="off" />
            </label>
          </div>
          <PendingButton pendingLabel="여는 중…" className={primary}>
            AWS 콘솔에서 연결 (CloudFormation)
          </PendingButton>
          <p className="text-stone-400">
            주제 ARN 을 비우면 새 주제 <span className="font-mono">alert-hub</span> 를 만듭니다 — 그때는 경보 알림에 이 주제를 추가해야 알람이 옵니다.
            해제: CloudFormation 에서 스택 <span className="font-mono">{STACK_NAME}</span> 삭제.
            {!templateReady || !hub ? <span className="text-[#b54708]"> · 아직 준비 안 됨: {!hub ? "AWS_ROLE_ARN " : ""}{!templateReady ? "CFN_TEMPLATE_URL" : ""}</span> : null}
          </p>
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
