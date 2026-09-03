# alert-hub 디자인 토큰 — v2 "웜 페이퍼 콘솔"

> 단일 기준(source of truth). 원본은 Claude Design의 `alert-hub v2.dc.html`
> (2026-09 공유본)이며, 이 문서는 그 캔버스를 코드 토큰으로 옮긴 것이다.
> 구현 반영: `tailwind.config.ts`(팔레트 리맵·라운딩 제거), `globals.css`,
> `src/components/badges.tsx`(도형 마크), `src/app/layout.tsx`(폰트·헤더).

## 1. 원칙

- **종이 위의 잉크.** 따뜻한 종이색 바탕(#fbfaf7) 위에 잉크(#1b1a17) 한 색으로
  위계를 만든다. 회색이 아니라 웜 그레이(스톤→모래) 스케일.
- **직각.** 라운딩 없음. 카드·버튼·인풋·칩 전부 0px. 원형은 상태 점·아바타 등
  "마크"에만 허용 (`rounded-full`).
- **도형 = 상태.** 상태·심각도는 색만이 아니라 도형으로도 구분된다:
  ●(dot) ▲(tri) ○(ring) ✓(check) –(dash). 색약 환경 대비.
- **모노 오버라인.** 섹션 제목·테이블 헤더·라벨은 Space Mono 700 10px,
  letter-spacing 0.11em, uppercase, FAINT 색.
- **액센트는 파랑 하나.** #1451d6 — 링크, 주 CTA(Acknowledge), 포커스 링.
  위험/경고 색은 상태 시맨틱에서만 나온다.

## 2. 팔레트

| 토큰 | 값 | Tailwind | 용도 |
|---|---|---|---|
| CANVAS | `#efece5` | — | (디자인 캔버스 전용, 앱 미사용) |
| BG | `#fbfaf7` | `body` | 앱 바탕 |
| SURFACE | `#ffffff` | `bg-white` | 카드·헤더·컨트롤 |
| SOFT | `#faf8f4` | `stone-50` | hover·뮤트 행·활성 틴트 |
| HAIR BG | `#f4f1ea` | `stone-100` | 칩 바탕, 셀 이음 헤어라인 |
| RULE | `#ded9cf` | `stone-200` | 모든 보더 |
| DECO | `#d3cec3` | `stone-300` | 장식 보더, 비활성 |
| FAINT | `#9a978f` | `stone-400` | 오버라인·보조 텍스트 |
| MUT | `#6b6862` | `stone-500` | 본문 보조 |
| INK2 | `#4a4842` | `stone-600` | 본문 강조 보조 |
| INK | `#1b1a17` | `stone-900` | 제목·본문·주 버튼 |
| ACCENT | `#1451d6` | `indigo-600` | 링크·CTA·포커스 |
| ACCENT HOVER | `#0f3fa8` | `indigo-700` | |

상태(도형과 짝):

| 상태 | 색 | 도형 |
|---|---|---|
| FIRING | `#b42318` | ● dot |
| ESCALATED | `#b54708` | ▲ tri |
| ACKNOWLEDGED | `#4a5568` | ○ ring |
| RESOLVED | `#067647` | ✓ check |
| NO DATA / MUTED | `#8a877f` | – dash |

심각도: SEV-0/1 ● `#b42318` (SEV-0은 `#7a1710`), SEV-2 ▲ `#b54708`,
SEV-3/4 ○ `#8a877f`, SEV-5 – `#8a877f`.

FIRING 활성 틴트 `#fdf5f4` (스탯 타일).

## 3. 타이포그래피

- 본문: **Pretendard** (가변 45–920, 셀프호스팅 `src/fonts/`) — 한글·라틴·
  숫자가 한 서체로 통일. `word-break: keep-all`로 어절 단위 줄바꿈.
  (2026-09: Instrument Sans+Noto Sans KR 혼용에서 교체 — OFL, 라이선스 원문
  동봉)
- 수치·코드·오버라인·타임스탬프: **Space Mono** (400/700), `tabular-nums` 전역.
- 페이지 타이틀: 27px/600/-0.025em. 서브페이지 22px/600/-0.02em.
- 히어로 제목(알람 상세): 26px/600/-0.025em.
- 본문 14px(text-sm), 보조 12px(text-xs), 캡션 11px — 세 단계로 통일
  (2026-09 가독성 패스에서 한 단계씩 상향: 13→14, 11→12, 10→11).
- 오버라인: mono 11px/700, tracking 0.07em, uppercase, FAINT — 한글이 섞이는
  라벨이라 자간을 0.11em에서 낮췄다.
- 배지 라벨: mono 11px/700, tracking 0.06em, 상태색.

## 4. 컴포넌트 규약

- **카드**: `border border-stone-200 bg-white`, 그림자 없음(팝오버만
  `0 18px 44px rgba(27,26,23,.18)`). 헤더 스트립: 오버라인 + `border-b`.
- **강조 카드**: 좌측 3px 상태색 보더 (`border-l-[3px]`).
- **버튼(32px)**: 주 = 잉크 배경/흰 글자, hover #000. CTA(Ack) = ACCENT 배경.
  보조 = 흰 배경 + RULE 보더, hover 보더 FAINT. 비활성 = `#f4f1ea` 배경 +
  `#b0aca2` 글자.
- **인풋/셀렉트(32px)**: 흰 배경 + RULE 보더. 포커스: 보더 ACCENT +
  `0 0 0 3px rgba(20,81,214,.14)`.
- **상태 칩(26px)**: 흰 배경 + RULE 보더 + 마크 + 라벨 + 모노 카운트.
  활성: 잉크 보더 + `#f7f5f0` 배경 + 600 weight.
- **스탯 타일**: 흰 상자 하나를 `stone-100` 세로 헤어라인으로 분할.
  마크+오버라인 / Space Mono 32px 수치. 활성: 상태색 inset 밑줄 2px + 틴트.
- **테이블**: 헤더 = 모노 오버라인 행(34px), 행 이음 `stone-100`.
  FIRING 행 좌측 3px `#b42318`. CNT는 mono 700, 8회 이상 붉게. ENV는
  mono 11px uppercase (prd만 잉크, 나머지 FAINT).
- **탭**: 밑줄 탭 — 활성 `inset 0 -2px 0 #1b1a17` + 600. 세그먼트 필 금지.
- **순번 마크**: 정사각(19~20px) — 1순위 잉크 배경/흰 글자, 이후 흰
  배경/RULE 보더.
- **아바타**: 26px 정사각, 이니셜 1자. 활성 시 잉크 반전.
- **조직 체인 구분자**: `›` (mono, `stone-300`).
- **타임라인**: 상태 도형 마크 + 1px 세로 연결선(`#e6e2d9`≈stone-200).

## 5. 남겨둔 것 (v2 캔버스에 있으나 기능 미구현)

~~뮤트 칩·점검 창~~ → 구현됨 (Silence 모델, /admin/silences, 상세 뮤트
팝오버, 대시보드 뮤트 칩 — v2 프레임 03·04).
~~파이프라인 헬스·통지 재시도 표기~~ → 구현됨 (NotificationJob 아웃박스,
헤더 인디케이터, 상세 "재시도 n/5" 행 — 신뢰성 트랙 ①).
~~Slack 묶음 통지·점검 종료 요약(프레임 05)~~ → 구현됨 (아웃박스 groupKey
다이제스트 + summaryAt 요약 틱, NOTIFY_DIGEST_WINDOW_SECONDS 기본 60초).
~~일괄 Ack·에스컬레이션 대기 카드·재발화 스로틀~~ → 구현됨 (대시보드 헤더
일괄 Ack, 우측 에스컬레이션 대기 카드, REFIRE_THROTTLE_MINUTES 기본 10분).

v2 캔버스의 다섯 프레임이 모두 기능으로 반영되었다.
