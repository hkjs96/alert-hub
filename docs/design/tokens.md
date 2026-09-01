# alert-hub 디자인 토큰 · 컴포넌트 규약 (B안 · 라이트 정밀)

코드 곳곳에 흩어진 스타일의 단일 원천. 새 화면 목업(Claude Design 캔버스
포함)과 구현이 이 문서를 따르면 서로 어긋나지 않는다. 값은 실제 코드
(Tailwind 클래스)와 1:1 — 코드가 바뀌면 이 문서도 바꾼다.

비주얼 방향은 design-directions/ 비교에서 **B안(라이트 정밀)** 채택:
웜 뉴트럴(stone) 바탕, 헤어라인 보더, 인디고 단일 액센트, 굵기·자간으로
만드는 타이포 위계. 다크 모드는 후속 — 이 토큰의 반전으로 얻는다.

## 원칙

- **정보 설계 우선**: 훑고 조작하는 운영 도구. 상태는 숫자보다 형태(배지·
  액센트·틴트)로 먼저 읽힌다.
- **색은 의미가 있을 때만**: 액센트는 인디고 1색(링크·주 액션·활성 상태).
  상태색(빨강·파랑·초록·주황)은 상태에만. 스탯 수치는 Firing만 빨강,
  나머지는 잉크.
- **사실과 정책의 분리**: 상태(FIRING)는 사실, 통지 여부(뮤트)는 정책 —
  정책이 사실의 표시를 지우지 않는다.
- **JS 없는 조작**: 링크와 폼 전송. 색만으로 의미 전달 금지(배지엔 라벨).

## 타이포그래피

- 패밀리: **Geist**(라틴) + **Noto Sans KR**(한글 폴백) — `font-sans`,
  숫자·시각·코드는 **Geist Mono** — `font-mono`
- 페이지 제목: `text-2xl font-semibold tracking-tight text-stone-900`
- 섹션 제목: `text-xl font-semibold` · 카드 제목 `text-sm font-semibold
  text-stone-700`
- 섹션 라벨: `text-xs font-semibold uppercase tracking-wide text-stone-500`
- 본문 14px(`text-sm`) · 메타 12px(`text-xs`) · 숫자 `tabular-nums`
- 위계는 크기보다 **굵기(400/500/600)와 잉크 농도**로

## 색 (Tailwind stone + 인디고 액센트 + 상태색)

| 역할 | 클래스 | hex |
|---|---|---|
| 페이지 배경 | (`--background`) | `#fafaf9` (stone-50) |
| 서피스(카드) | `bg-white` + `border-stone-200` | `#ffffff` / `#e7e5e4` |
| 본문 잉크 | `text-stone-900` | `#1c1917` |
| 보조 텍스트 | `text-stone-500` / `-400` | `#78716c` / `#a8a29e` |
| 구분선 | `divide-stone-100` | `#f5f5f4` |
| **액센트(유일)** | `text-indigo-600`, 활성 틴트 `bg-indigo-50 text-indigo-700 ring-indigo-200` | `#4f46e5` / `#eef2ff` |
| FIRING 배지 | `bg-red-50 text-red-700 ring-red-200` + 행 액센트 `border-l-red-600` | |
| ACK 배지 | `bg-blue-50 text-blue-700 ring-blue-200` | |
| RESOLVED 배지 | `bg-green-50 text-green-700 ring-green-200` | |
| ESCALATED 배지 | `bg-orange-50 text-orange-700 ring-orange-200` | |
| NO DATA 배지 | `bg-stone-100 text-stone-600 ring-stone-300` | |
| 경고 배너 | `bg-amber-50 border-amber-200 text-amber-800` | |
| 심각도 SEV-0/1 | `bg-red-600/500 text-white` · SEV-2 `bg-orange-500` · SEV-3 `bg-amber-400` | |

상태 배지 라벨은 문장 케이스: Firing / Ack / Resolved / Escalated / No Data.

## 형태

- 카드: `rounded-lg`(8px) + `border-stone-200` + `shadow-sm`
- **스탯 타일 밴드**: 떠 있는 카드 5장이 아니라 `gap-px bg-stone-200
  rounded-xl overflow-hidden` 이음선 밴드. 활성 = `bg-indigo-50` 틴트.
  수치는 `text-2xl font-semibold tracking-tight tabular-nums`
- 버튼: `rounded-md`(6px). 주 버튼 `bg-stone-900 text-white`, 핵심 액션(Ack)
  `bg-indigo-600`, 보조 `border-stone-300 bg-white`, 비활성은 숨기지 않고
  `disabled:bg-stone-100 disabled:text-stone-400`
- 배지: `rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset` —
  옅은 바탕 + 같은 계열 보더 (진한 채움 금지)
- 칩(필터/담당 패널): pill. **활성 = 인디고 틴트**(`bg-indigo-50
  text-indigo-700 ring-indigo-200`), 비활성 `bg-white ring-stone-200`
- 순번 배지: `h-5 w-5 rounded tabular-nums` — 1순위 `bg-stone-900
  text-white`, 나머지 `bg-stone-100 text-stone-500`
- 테이블: 헤더 `bg-stone-50 text-xs uppercase text-stone-500`, 셀 `px-3
  py-3`, 행 구분 `divide-stone-100`, hover `bg-stone-50`, FIRING 행 좌측
  `border-l-[3px] border-l-red-600`, Count·Last seen은 `font-mono text-xs`

## 재사용 패턴

- 스탯 타일 5개: 클릭=상태 토글, 수치는 "상태를 제외한 현재 필터" 기준.
- 스코프 선택자: 고객사 ▾ / 프로젝트 ▾ / 서비스 ▾ + [이동|적용].
- 레벨 탭: `bg-stone-100 p-1 rounded-lg` 안에 활성 `bg-white shadow-sm`.
- 타임라인: 좌측 보더 + 상태 배지 + UTC 시각, append-only.
- 아이콘: 이모지 금지(Slack 발신 본문 제외), 16/20px 스트로크 인라인 SVG.

## 카피 톤

- 화면·기능 이름은 사용자의 일 기준: "알람 처리 순서", "점검 · 뮤트".
- 빈 상태는 원인과 다음 행동을 함께.
- 시각은 UTC 고정(`08-30 11:13Z`), 상세에서만 초 단위.
