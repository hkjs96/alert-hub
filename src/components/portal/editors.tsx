import { PendingButton } from "@/components/pending-button";
import {
  portalCreateChannel,
  portalCreateContact,
  portalCreateSilence,
  portalDeleteChannel,
  portalRevokeSilence,
  portalTestChannel,
  portalToggleChannel,
  portalUpdateContact,
} from "@/server/portal-actions";

// 고객사 포털의 쓰기 폼. 권한이 켜진 항목에만 그려진다 — 폼이 안 보이는 것이
// 방어가 아니라, 서버 액션이 같은 권한과 소유를 다시 확인하는 것이 방어다.

const control =
  "h-8 rounded-md border border-stone-300 bg-white px-2.5 text-sm shadow-[0_1px_0_rgba(28,25,23,0.02)] transition-colors hover:border-stone-400";
const overline = "font-mono text-[11px] uppercase tracking-[0.06em] text-stone-400";
const primary =
  "inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-700";
const ghost =
  "inline-flex h-7 items-center rounded-md border border-stone-300 bg-white px-2 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50";

export interface ScopeChoice {
  value: string;
  label: string;
}

export function ContactCreateForm() {
  return (
    <form action={portalCreateContact} className="flex flex-wrap items-end gap-1.5 border-t border-stone-100 px-6 py-3 text-sm">
      <label className="block w-28">
        <span className={`mb-1 block ${overline}`}>이름</span>
        <input name="name" required className={`${control} w-full`} />
      </label>
      <label className="block w-24">
        <span className={`mb-1 block ${overline}`}>부서</span>
        <input name="department" className={`${control} w-full`} />
      </label>
      <label className="block w-44">
        <span className={`mb-1 block ${overline}`}>이메일</span>
        <input name="email" type="email" className={`${control} w-full`} />
      </label>
      <label className="block w-32">
        <span className={`mb-1 block ${overline}`}>Slack ID</span>
        <input name="slackId" placeholder="U0123ABC" className={`${control} w-full font-mono`} />
      </label>
      <label className="block w-36">
        <span className={`mb-1 block ${overline}`}>전화</span>
        <input name="phone" placeholder="010-0000-0000" className={`${control} w-full font-mono`} />
      </label>
      <PendingButton pendingLabel="추가 중…" className={primary}>
        + 담당자
      </PendingButton>
    </form>
  );
}

export function ContactEditForm({
  contact,
}: {
  contact: {
    id: string;
    name: string;
    department: string | null;
    email: string | null;
    slackId: string | null;
    phone: string | null;
    active: boolean;
  };
}) {
  return (
    <details className="basis-full">
      <summary className="cursor-pointer select-none text-xs text-stone-500 hover:text-stone-900">수정</summary>
      <form action={portalUpdateContact} className="mt-2 flex flex-wrap items-end gap-1.5">
        <input type="hidden" name="id" value={contact.id} />
        <label className="block w-28">
          <span className={`mb-1 block ${overline}`}>이름</span>
          <input name="name" defaultValue={contact.name} required className={`${control} w-full`} />
        </label>
        <label className="block w-24">
          <span className={`mb-1 block ${overline}`}>부서</span>
          <input name="department" defaultValue={contact.department ?? ""} className={`${control} w-full`} />
        </label>
        <label className="block w-44">
          <span className={`mb-1 block ${overline}`}>이메일</span>
          <input name="email" type="email" defaultValue={contact.email ?? ""} className={`${control} w-full`} />
        </label>
        <label className="block w-32">
          <span className={`mb-1 block ${overline}`}>Slack ID</span>
          <input name="slackId" defaultValue={contact.slackId ?? ""} className={`${control} w-full font-mono`} />
        </label>
        <label className="block w-36">
          <span className={`mb-1 block ${overline}`}>전화</span>
          <input name="phone" defaultValue={contact.phone ?? ""} className={`${control} w-full font-mono`} />
        </label>
        <label className="flex h-8 items-center gap-1.5 text-sm text-stone-700">
          <input type="checkbox" name="active" defaultChecked={contact.active} className="h-4 w-4 accent-stone-900" />
          활성
        </label>
        <PendingButton pendingLabel="저장 중…" className={primary}>
          저장
        </PendingButton>
      </form>
    </details>
  );
}

export function SilenceCreateForm({ scopes }: { scopes: ScopeChoice[] }) {
  return (
    <form action={portalCreateSilence} className="flex flex-wrap items-end gap-1.5 border-t border-stone-100 px-6 py-3 text-sm">
      <label className="block w-52">
        <span className={`mb-1 block ${overline}`}>범위</span>
        <select name="levelScope" required defaultValue={scopes[0]?.value} className={`${control} w-full`}>
          {scopes.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block w-28">
        <span className={`mb-1 block ${overline}`}>기간</span>
        <select name="preset" defaultValue="1h" className={`${control} w-full`}>
          <option value="1h">1시간</option>
          <option value="4h">4시간</option>
          <option value="today23">오늘 23시</option>
          <option value="tomorrow9">내일 9시</option>
        </select>
      </label>
      <label className="block w-56">
        <span className={`mb-1 block ${overline}`}>사유 (필수)</span>
        <input name="reason" required placeholder="정기 배포 점검" className={`${control} w-full`} />
      </label>
      <PendingButton pendingLabel="등록 중…" className={primary}>
        + 점검 창
      </PendingButton>
      <span className="basis-full text-xs text-stone-400">
        점검 창 동안 그 범위의 통지와 에스컬레이션이 멈춥니다(수집과 화면 표시는 계속).
      </span>
    </form>
  );
}

export function SilenceRevokeButton({ id }: { id: string }) {
  return (
    <form action={portalRevokeSilence} className="ml-auto inline">
      <input type="hidden" name="id" value={id} />
      <button className={ghost}>지금 해제</button>
    </form>
  );
}

export function ChannelCreateForm({ scopes, botReady }: { scopes: ScopeChoice[]; botReady: boolean }) {
  return (
    <form action={portalCreateChannel} className="flex flex-wrap items-end gap-1.5 border-t border-stone-100 px-6 py-3 text-sm">
      <label className="block w-44">
        <span className={`mb-1 block ${overline}`}>범위</span>
        <select name="levelScope" required defaultValue={scopes[0]?.value} className={`${control} w-full`}>
          {scopes.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block w-40">
        <span className={`mb-1 block ${overline}`}>종류</span>
        <select name="kind" defaultValue={botReady ? "SLACK_BOT" : "SLACK_WEBHOOK"} className={`${control} w-full`}>
          <option value="SLACK_BOT" disabled={!botReady}>
            MSP 봇 채널{botReady ? "" : " (봇 미설정)"}
          </option>
          <option value="SLACK_WEBHOOK">우리 워크스페이스 웹훅</option>
        </select>
      </label>
      <label className="block w-32">
        <span className={`mb-1 block ${overline}`}>이름</span>
        <input name="label" required placeholder="운영 알림" className={`${control} w-full`} />
      </label>
      <label className="block w-64">
        <span className={`mb-1 block ${overline}`}>채널 · 웹훅 URL</span>
        <input name="target" required placeholder="#alerts 또는 https://hooks.slack.com/…" className={`${control} w-full font-mono`} />
      </label>
      <PendingButton pendingLabel="추가 중…" className={primary}>
        + 채널
      </PendingButton>
      <span className="basis-full text-xs text-stone-400">
        봇 채널이 비공개라면 <code className="font-mono">/invite @alert-hub</code> 가 필요합니다. 등록 뒤 “테스트”로 도달을 확인하세요.
      </span>
    </form>
  );
}

export function ChannelRowActions({ id, enabled }: { id: string; enabled: boolean }) {
  return (
    <span className="ml-auto flex items-center gap-1.5">
      <form action={portalTestChannel} className="inline">
        <input type="hidden" name="id" value={id} />
        <button className={ghost}>테스트</button>
      </form>
      <form action={portalToggleChannel} className="inline">
        <input type="hidden" name="id" value={id} />
        <button className={ghost}>{enabled ? "끄기" : "켜기"}</button>
      </form>
      <form action={portalDeleteChannel} className="inline">
        <input type="hidden" name="id" value={id} />
        <button aria-label="채널 삭제" className="px-1 text-stone-400 hover:text-[#b42318]">
          ×
        </button>
      </form>
    </span>
  );
}
