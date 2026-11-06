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
      <ConnectFields accountId={accountId} regions={regions} />
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
        해제: CloudFormation 에서 스택 <span className="font-mono">{stackName}</span> 삭제 한 번 (주제·구독·역할이 함께 사라지고 경보는 그대로).
      </p>
    </form>
  );
}

/** SNS 주제를 새로 만들지 / 이미 쓰는 주제를 그대로 쓸지 고르는 칸. */
function ConnectFields({ accountId, regions }: { accountId: string; regions: string[] }) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  return (
    <div className="space-y-2 text-stone-700">
      <p><b>① 알람을 받을 SNS 주제(Topic)</b> — 경보가 알림을 보내는 곳. alert-hub 는 이 주제를 구독해서 알람을 받습니다.</p>
      <div className="grid gap-2 md:grid-cols-2">
        <label className={`block cursor-pointer border px-2.5 py-2 ${mode === "new" ? "border-stone-900 bg-white" : "border-stone-200"}`}>
          <span className="flex items-center gap-1.5 font-semibold">
            <input type="radio" name="topicMode" checked={mode === "new"} onChange={() => setMode("new")} className="accent-stone-900" />
            새 주제 만들기 <span className="font-normal text-stone-500">(기존 알림 설정과 분리)</span>
          </span>
          <span className="mt-1 block text-stone-500">
            주제 <span className="font-mono">alert-hub</span> 를 새로 만듭니다. 스택을 만든 뒤 alert-hub 로 받고 싶은 <b>경보마다</b> 작업 탭 › 알림에 이 주제를 추가해야 알람이 옵니다.
          </span>
        </label>
        <label className={`block cursor-pointer border px-2.5 py-2 ${mode === "existing" ? "border-stone-900 bg-white" : "border-stone-200"}`}>
          <span className="flex items-center gap-1.5 font-semibold">
            <input type="radio" name="topicMode" checked={mode === "existing"} onChange={() => setMode("existing")} className="accent-stone-900" />
            이미 쓰는 주제 그대로 쓰기 <span className="font-normal text-stone-500">(경보 수정 없음)</span>
          </span>
          <span className="mt-1 block text-stone-500">
            경보가 이미 보내는 주제에 alert-hub 구독만 추가합니다. 기존 수신자(이메일·247)는 그대로.
          </span>
        </label>
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
        {mode === "existing" ? (
          <label className="block min-w-[18rem] flex-1">
            <span className="mb-1 block text-[11px] font-semibold text-stone-500">
              이미 쓰는 주제 ARN — CloudWatch › 경보 › 작업 탭에서 주제 이름 확인 → SNS › 주제 › ARN 복사
            </span>
            <input
              name="existingTopicArn"
              required
              placeholder={`arn:aws:sns:ap-northeast-2:${accountId}:주제이름`}
              className="h-8 w-full border border-stone-300 bg-white px-2 font-mono text-[11px]"
            />
          </label>
        ) : null}
        <label className="inline-flex items-center gap-1.5 pb-1.5">
          <input type="checkbox" name="createRole" value="on" defaultChecked className="accent-stone-900" />
          그래프 역할도 만들기 <span className="text-stone-400">(계정당 한 번 — 이미 있으면 끄기)</span>
          <input type="hidden" name="createRole" value="off" />
        </label>
      </div>
      <p className="pt-1"><b>② 연결 링크 만들기</b> → 계정 <span className="font-mono font-semibold">{accountId}</span> 로 로그인된 창에서 열기 → 맨 아래 <b>IAM 리소스 생성 동의</b> 체크 → <b>스택 생성</b></p>
    </div>
  );
}
