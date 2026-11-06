"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { connectAws, type ConnectState } from "@/server/aws-actions";
import { PendingButton } from "@/components/pending-button";

const primary =
  "inline-flex h-9 items-center bg-stone-900 px-4 text-sm font-semibold text-white hover:bg-black";
const btn =
  "inline-flex h-8 items-center border border-stone-300 bg-white px-3 text-xs font-medium text-stone-900 hover:border-stone-500";

/**
 * "연결 링크 만들기" → 서버가 CloudFormation 빠른 생성 주소를 돌려준다(이동하지 않음).
 * 그 아래에 "새 창으로 열기"·"주소 복사" — 다른 브라우저/프로필(고객사 계정 로그인)에서 열 수 있게.
 * 실패해도 상태로 돌아오므로 버튼이 멈추지 않는다.
 */
export function ConnectForm({
  accountMapId,
  accountId,
  regions,
  stackName,
  notReady,
}: {
  accountMapId: string;
  accountId: string;
  regions: string[];
  stackName: string;
  notReady: string | null;
}) {
  const [state, action] = useFormState<ConnectState, FormData>(connectAws, null);
  const [copied, setCopied] = useState<number | null>(null);
  const url = state && "url" in state ? state.url : null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(Date.now());
    } catch {
      window.prompt("이 주소를 복사하세요", url);
    }
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="accountMapId" value={accountMapId} />
      {notReady ? (
        <p className="border border-[#f3d9b8] bg-[#fdf6ec] px-2.5 py-1.5 text-[#b54708]">
          아직 준비 안 됨: {notReady} — Vercel 환경변수를 넣고 재배포하세요.
        </p>
      ) : null}
      <div className="space-y-1 text-stone-700">
        <p>
          <b>① 경보가 쓰는 SNS 주제 ARN 찾기</b> (계정 <span className="font-mono font-semibold">{accountId}</span> 콘솔에서)
        </p>
        <ol className="ml-4 list-decimal space-y-0.5 text-stone-600">
          <li>CloudWatch › 경보 › 경보 하나 클릭 › <b>작업</b> 탭 → &ldquo;알림&rdquo; 에 적힌 SNS 주제 이름 확인</li>
          <li>SNS › 주제 › 그 이름 클릭 → 맨 위 <b>ARN</b> 복사 (<span className="font-mono">arn:aws:sns:리전:{accountId}:주제이름</span>)</li>
          <li>아래 칸에 붙여 넣기. 이미 경보가 쓰는 주제라 <b>구독만 하나 추가</b>되고 경보·기존 수신자는 그대로입니다.</li>
        </ol>
        <p className="text-stone-500">
          ⚠ CloudFormation 이 만든 <span className="font-mono">…:alert-hub</span> 주제나 구독(<span className="font-mono">…:alert-hub:xxxx</span>) ARN 은 넣지 마세요 — 그건 결과물입니다.
        </p>
        <p className="pt-1"><b>② 연결 링크 만들기</b> → 그 계정으로 로그인된 창에서 열기 → 맨 아래 <b>IAM 리소스 생성 동의</b> 체크 → <b>스택 생성</b></p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-stone-500">리전</span>
          <select name="region" defaultValue="ap-northeast-2" className="h-8 border border-stone-300 bg-white px-2 text-xs">
            {regions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-[18rem] flex-1">
          <span className="mb-1 block text-[11px] font-semibold text-stone-500">
            ① 에서 찾은 SNS 주제 ARN (비우면 새 주제를 만들고, 경보에 직접 추가해야 함)
          </span>
          <input
            name="existingTopicArn"
            placeholder={`arn:aws:sns:ap-northeast-2:${accountId}:기존주제이름`}
            className="h-8 w-full border border-stone-300 bg-white px-2 font-mono text-[11px]"
          />
        </label>
        <label className="inline-flex items-center gap-1.5 pb-1.5">
          <input type="checkbox" name="createRole" value="on" defaultChecked className="accent-stone-900" />
          그래프 역할도 만들기
          <input type="hidden" name="createRole" value="off" />
        </label>
      </div>
      <PendingButton pendingLabel="만드는 중…" className={primary}>
        연결 링크 만들기 (CloudFormation)
      </PendingButton>

      {state && "error" in state ? (
        <p key={state.at} className="border border-[#f3d9b8] bg-[#fdf6ec] px-2.5 py-1.5 text-[#b54708]">{state.error}</p>
      ) : null}
      {url ? (
        <div key={state!.at} className="space-y-1.5 border border-emerald-200 bg-emerald-50/60 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <a href={url} target="_blank" rel="noopener noreferrer" className={btn}>↗ 새 창으로 열기</a>
            <button type="button" onClick={copy} className={btn}>{copied ? "✓ 복사됨" : "주소 복사"}</button>
            <span className="text-stone-500">고객사 계정이 다른 브라우저·프로필에 로그인돼 있으면 복사해서 거기에 붙여 넣으세요.</span>
          </div>
          <code className="block max-h-16 select-all overflow-auto break-all bg-white px-2 py-1 font-mono text-[10px] text-stone-500">{url}</code>
        </div>
      ) : null}

      <p className="text-stone-400">
        이미 스택 <span className="font-mono">{stackName}</span> 을 주제 없이 만들었다면: 스택 삭제 후 주제 ARN 을 넣어 다시 하거나,
        각 경보의 작업에 새 주제 <span className="font-mono">…:alert-hub</span> 를 추가하세요. 해제는 스택 삭제 한 번.
      </p>
    </form>
  );
}
