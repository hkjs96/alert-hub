# alert-hub 디자인 토큰 · 컴포넌트 규약

코드 곳곳에 흩어진 스타일의 단일 원천. 새 화면 목업(Claude Design 캔버스
포함)과 구현이 이 문서를 따르면 서로 어긋나지 않는다. 값은 전부 실제
코드(Tailwind 클래스)에서 역추출한 것 — 코드가 바뀌면 이 문서도 바꾼다.

## 원칙

- **정보 설계 우선**: 이 제품은 읽는 문서가 아니라 훑고 조작하는 운영
  도구다. 상태는 숫자보다 형태(배지·칩·액센트)로 먼저 읽혀야 한다.
- **사실과 정책의 분리**: 알람의 상태(FIRING)는 사실, 통지 여부(뮤트)는
  정책. 정책이 사실의 표시를 지우지 않는다 — 배지는 남기고 행을 가라앉힌다.
- **JS 없는 조작**: 모든 조작은 링크와 폼 전송. 종속 선택은 "적용" 버튼으로
  한 번에.
- 색만으로 의미를 전달하지 않는다 (배지에는 항상 라벨).

## 타이포그래피

- 패밀리: 시스템 스택 (Tailwind 기본 `ui-sans-serif, system-ui, …`,
  한글은 Apple SD Gothic Neo / Malgun Gothic 폴백)
- 페이지 제목: `text-2xl font-semibold text-slate-900` (24px/600)
- 섹션 제목: `text-xl font-semibold` (20px) · 카드 제목: `text-sm
  font-semibold text-slate-700`
- 섹션 라벨(대문자): `text-xs font-semibold uppercase tracking-wide
  text-slate-500`
- 본문: `text-sm text-slate-…` (14px) · 메타: `text-xs` (12px)
- 숫자 정렬: `tabular-nums`

## 색 (Tailwind slate + 상태색)

| 역할 | 클래스 | hex |
|---|---|---|
| 페이지 배경 | (`--background`) | `#f8fafc` (slate-50) |
| 서피스(카드) | `bg-white` + `border-slate-200` | `#ffffff` / `#e2e8f0` |
| 본문 잉크 | `text-slate-900` | `#0f172a` |
| 보조 텍스트 | `text-slate-500` / `-400` | `#64748b` / `#94a3b8` |
| 구분선 | `divide-slate-100` | `#f1f5f9` |
| 링크/액센트 | `text-blue-600` | `#2563eb` |
| FIRING | `bg-red-100 text-red-800` + 행 액센트 `red-500` | `#fee2e2`/`#991b1b`/`#ef4444` |
| ACKNOWLEDGED | `bg-blue-100 text-blue-800` | `#dbeafe`/`#1e40af` |
| RESOLVED | `bg-green-100 text-green-800` | `#dcfce7`/`#166534` |
| ESCALATED (이벤트) | `bg-orange-100 text-orange-800` | `#ffedd5`/`#9a3412` |
| NO DATA | `bg-gray-100 text-gray-700` | `#f3f4f6`/`#374151` |
| 경고 배너 | `bg-amber-50 border-amber-200 text-amber-800` | `#fffbeb`/`#fde68a`/`#92400e` |
| 심각도 SEV-0/1 | `bg-red-600/500 text-white` | `#dc2626`/`#ef4444` |
| SEV-2 / SEV-3 | `bg-orange-500` / `bg-amber-400` | `#f97316`/`#fbbf24` |

## 형태

- 카드: `rounded-lg`(8px) + `border-slate-200` + `shadow-sm`
- 버튼: `rounded-md`(6px). 주 버튼 `bg-slate-900 text-white
  hover:bg-slate-700`, 액션 버튼(Ack) `bg-blue-600`, 보조 버튼
  `border-slate-300 bg-white`, 비활성 `disabled:bg-slate-100
  disabled:text-slate-400` (숨기지 않고 비활성 — 규칙이 보이게)
- 배지(상태/심각도): `rounded-md px-2 py-0.5 text-xs font-medium ring-1
  ring-inset`
- 칩(필터/인원): `rounded-full px-3 py-1 text-sm` — 활성 `bg-slate-900
  text-white`, 비활성 `bg-white ring-1 ring-slate-200`
- 순번 배지: `h-5 w-5 rounded tabular-nums` — 1순위 `bg-slate-900
  text-white`, 나머지 `bg-slate-100 text-slate-500`
- 입력/셀렉트: `rounded-md border-slate-300 px-2 py-1`
- 테이블: 헤더 `bg-slate-50 text-xs uppercase text-slate-500`, 행 구분
  `divide-slate-100`, hover `bg-slate-50`, FIRING 행 좌측 `border-l-[3px]
  border-l-red-500`

## 재사용 패턴

- **스탯 타일 5개**: Firing/Acked/Resolved/No Data/Total, 클릭=상태 토글,
  활성 시 링. 수치는 "상태를 제외한 현재 필터" 기준 (전역 수치 금지).
- **스코프 선택자**: 고객사 ▾ / 프로젝트 ▾ / 서비스 ▾ + [이동|적용] —
  배정·처리순서·점검 화면이 공유하는 패턴.
- **레벨 탭**: `bg-slate-100 p-1 rounded-lg` 안에 활성 `bg-white shadow-sm`.
- **타임라인**: 좌측 보더 + 상태 배지 + 시각(UTC `…Z`), append-only.
- **아이콘**: 이모지 금지(Slack 발신 메시지 본문 제외), 16/20px 스트로크
  인라인 SVG.

## 카피 톤

- 화면·기능 이름은 사용자의 일 기준: "알람 처리 순서", "점검 · 뮤트",
  "담당 인원" (시스템 구조 이름 금지)
- 빈 상태는 원인과 다음 행동을 함께: "필터 조건에 맞는 알람이 없습니다 —
  필터 초기화"
- 시각은 UTC 고정 표기(`08-30 11:13Z`), 상세에서만 초 단위.
