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
      <p className="text-stone-700">
        <b>연결 링크 만들기</b> → 계정 <span className="font-mono font-semibold">{accountId}</span> 으로 AWS 콘솔에 로그인된 창에서 링크 열기 →
        맨 아래 <b>IAM 리소스 생성 동의</b> 체크 → <b>스택 생성</b>. 끝.
      </p>
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
            지금 쓰는 SNS 주제 ARN (선택 — 넣으면 그 주제에 구독만 추가, 경보는 그대로)
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
        주제 ARN 을 비우면 새 주제 <span className="font-mono">alert-hub</span> 를 만듭니다 — 그때는 경보 알림에 이 주제를 추가해야 알람이 옵니다.
        해제: CloudFormation 에서 스택 <span className="font-mono">{stackName}</span> 삭제.
      </p>
    </form>
  );
}
