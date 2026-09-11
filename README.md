# alert-hub

The **event plane** for alarms. Something else (e.g. `aws-alert-manager`, or any
monitoring stack) *creates* alarms; alert-hub *receives* the ones that fire,
deduplicates them, stores a provider-agnostic record, shows them on a dashboard,
and notifies Slack. Think "the seat where PagerDuty sits" — it does not manage or
CRUD alarm definitions.

This is Phase 1 (MVP): **receive → store → dashboard → Slack**. It is built so
later phases (email, ack/resolve actions, on-call/escalation, Twilio SMS/voice)
bolt on without a rewrite.

## Stack

Next.js 14 (App Router, `src/`, TS strict) · Prisma + PostgreSQL · Tailwind ·
Slack Incoming Webhook. API routes run on the Node.js runtime.

## Architecture (why it looks like this)

- **Provider-agnostic core.** Every incoming payload is normalized into one
  `NormalizedAlert` shape (`src/lib/normalize.ts`). Storage, dashboard, and
  notifiers only ever see that shape, so adding sources never changes downstream
  code.
- **Notifier interface.** Channels live behind `Notifier`
  (`src/lib/notify/index.ts`). Slack is the only one today; email/Twilio are
  just more registered notifiers later.
- **Explicit status + append-only history.** `status` is one of
  `FIRING | RESOLVED | ACKNOWLEDGED | INSUFFICIENT_DATA`. Every ingest appends an
  immutable `AlertEvent`, so ack/resolve actions can be added later without
  losing history.
- **Room to grow.** The `Alert` model leaves space for future
  assignee/routing/grouping without forcing those columns now.

## Getting started

가장 빠른 길 — Docker만 있으면 두 명령으로 화면까지 봅니다:

```bash
docker compose up -d db     # 로컬 Postgres 16
npm install && npm run demo # .env 생성 → 스키마 → 시드 → dev 서버 → 샘플 알람 5건
```

`npm run demo`는 반복 실행해도 안전합니다(.env는 있으면 보존, 시드는 빈 DB에만,
샘플 알람은 fingerprint dedup에 흡수). Docker가 없으면 아무 Postgres — 로컬
설치든 Supabase 무료 티어든 — 를 쓰고 `.env`의 두 URL만 채운 뒤 같은 명령을
실행하면 됩니다.

수동으로 단계별로 하려면:

```bash
npm install
cp .env.example .env        # set DATABASE_URL + DIRECT_URL (and SLACK_WEBHOOK_URL)
npx prisma generate
npx prisma db push          # create the tables in your Postgres
npm run db:seed             # demo org data (only ever writes to an EMPTY db)
npm run dev                 # http://localhost:3000
```

### Try the 2b flow in two minutes

The seed creates the org tree and assignments but **no alerts** — fire those
through the real webhook so ingest, dedup, the fire-time ownership snapshot,
and Slack (if configured) all run:

```bash
# mapped account → resolves to 결제서비스's order (최민서 1순위), snapshot frozen
curl -X POST localhost:3000/api/webhooks/cloudwatch -H 'content-type: application/json' -d '{
  "AlarmName": "SEV-1 CPU 사용률 90% 초과", "NewStateValue": "ALARM",
  "AlarmArn": "arn:aws:cloudwatch:ap-northeast-2:123456789012:alarm:cpu-high",
  "NewStateReason": "Threshold Crossed" }'

# unmapped account → ⚠ 매핑 필요 badge + dashboard banner
curl -X POST localhost:3000/api/webhooks/cloudwatch -H 'content-type: application/json' -d '{
  "AlarmName": "SEV-2 신규 계정 알람", "NewStateValue": "ALARM",
  "AlarmArn": "arn:aws:cloudwatch:ap-northeast-2:999999999999:alarm:mystery" }'
```

Then, on the dashboard: the first alert shows 담당 최민서 (service order beats
the customer default), the second shows the unmapped banner. Open the first
alert, reorder the team on 알람 처리 순서 — the alert keeps showing the
frozen snapshot with a "현재 등록 기준과 다릅니다" hint, until the alarm
re-fires (OK → ALARM) and freezes the new order.

PoC setup is **local dev + Supabase free Postgres**. Supabase ships a built-in
connection pooler (Supavisor), so the runtime uses the **pooled** URL
(`DATABASE_URL`, port 6543) while migrations use the **direct** URL
(`DIRECT_URL`, port 5432). Using the pooler now means a later move to
Lambda/Vercel needs **no RDS Proxy** — the connection-pool problem is already
handled. Locally, point both URLs at the same Postgres.

### Environment variables

| Var                 | Required | Purpose                                                    |
| ------------------- | -------- | ---------------------------------------------------------- |
| `DATABASE_URL`      | yes      | Pooled Postgres URL (app runtime).                         |
| `DIRECT_URL`        | yes      | Direct Postgres URL (migrations / `db push`).              |
| `SLACK_WEBHOOK_URL` | no       | Slack Incoming Webhook — 전사 폴백 채널. 스코프별 채널이 없을 때 쓰인다. |
| `SLACK_BOT_TOKEN` `SLACK_DEFAULT_CHANNEL` | no | Slack 앱 봇 토큰(`xoxb-…`, scopes `chat:write` `chat:write.public` `im:write` `users:read` `users:read.email`)과 전사 기본 채널. 있으면 스코프별 "우리 채널", 에스컬레이션 DM, 확인 코드 DM, 로그인 시 Slack ID 자동 연결이 켜진다. |
| `SLACK_SIGNING_SECRET` | no | Slack 앱의 Signing Secret. 있으면 봇 메시지에 **확인 · 해결 · 1시간 뮤트 버튼**이 붙고 `/api/slack/interactive` 가 그 클릭을 받는다. 앱 설정 › Interactivity & Shortcuts 를 켜고 Request URL 을 `<APP_URL>/api/slack/interactive` 로. |
| `APP_URL`           | no       | Public base URL; adds an alert deep link to notifications.   |
| `INGEST_TOKEN`      | no       | If set, requests must carry the token (see below).            |
| `SMTP_HOST` `SMTP_FROM` | no   | Enable the email notifier. `SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS` refine it. |
| `CRON_SECRET`       | no       | Enables `GET /api/cron/escalate` (자동 에스컬레이션). Unset ⇒ endpoint answers 503. |
| `ESCALATION_ACK_MINUTES` | no  | 미ack 에스컬레이션 창(분). Default 10.                        |
| `TWILIO_ACCOUNT_SID` `TWILIO_AUTH_TOKEN` `TWILIO_FROM` | no | Enable SMS on escalation (에스컬레이션 전용 — 최초 통지엔 침묵). `TWILIO_VOICE=true` adds a TTS call. |
| `SNS_VERIFY`        | no       | SNS 봉투 서명 검증. Default **on**; `false`로만 해제.        |
| `PAGERDUTY_WEBHOOK_SECRET` | no | Set ⇒ PagerDuty requests must carry a valid `X-PagerDuty-Signature` (v1 HMAC). |
| `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `AUTH_SECRET` | no | 셋 다 있으면 **Google SSO**가 켜지고 화면·서버 액션이 로그인 뒤로 들어간다(웹훅·크론은 자체 비밀로 통과). 하나라도 없으면 지금처럼 열린 상태, 헤더에 "SSO 미설정"이 보인다. `AUTH_SECRET`은 16자 이상 무작위 문자열. |
| `AUTH_ALLOWED_DOMAINS` | no | SSO 허용 이메일 도메인(쉼표 구분, 예 `mz.co.kr,megazone.com`). |
| `AUTH_ALLOWED_EMAILS` | no | 도메인과 무관하게 허용할 개별 이메일(쉼표 구분). 개인 Gmail이나 외부 협력자용. 두 변수가 모두 비면 어떤 Google 계정이든 들어올 수 있으니 운영에서는 반드시 하나는 둔다. |
| `AUTH_BOOTSTRAP_ADMINS` | no | 첫 로그인에 바로 **관리자·활성**이 되는 이메일(쉼표 구분). 비어 있어도 **관리자가 한 명도 없으면 첫 로그인 계정이 관리자**가 된다. |
| `AUTH_AUTO_APPROVE` (계정 · 접근의 "가입 방식" 스위치가 우선) | no | `true`면 허용 목록 계정은 승인 없이 로그인 즉시 온콜 엔지니어로 활성. 기본(승인제)은 관리자가 계정 · 접근에서 승인한다. |

### 실제 고객사 투입 전 체크리스트

> 사람이 할 일의 체크박스 목록은 [docs/launch-checklist.md](docs/launch-checklist.md) 에서 관리한다.

1. **데모 데이터 정리** — 운영 DB에서 `npm run demo:reset`(먼저 인자 없이 돌려 목록 확인, `--yes`로 삭제).
   Vercel에서는 `DATABASE_URL`을 로컬 셸에 넣고 실행하면 된다. 시드 데모 고객사·알람·내부 데모 인원만 지운다.
2. **`SEED_DEMO=false`** 를 Vercel 환경변수에 추가 — 빈 DB에 배포하면 데모 시드가 다시 들어가는 것을 막는다.
3. **`INGEST_TOKEN`**, **`CRON_SECRET`** 설정. 웹훅 URL에는 `?token=`으로 박는다(SNS는 헤더를 못 붙인다).
4. **SSO**(아래) — 실제 고객사 알람이 보이는 화면을 URL만으로 열어 두지 않는다.
5. 외부 스케줄러(cron-job.org, QStash 등)로 `/api/cron/notify`·`/api/cron/escalate`를 1분 간격 호출.
6. 조직 트리 → **새 고객사 온보딩**으로 고객사 › 프로젝트 › 서비스 › AWS 계정 매핑 › 담당자를 만들고,
   고객사 AWS 계정마다 SNS 토픽 → HTTPS 구독(`/api/webhooks/cloudwatch?token=…`) → CloudWatch 알람 액션을 건다.
   구독 확인은 자동, SNS 서명 검증은 기본 켜짐.

### 통지 채널 (고객사·프로젝트별 Slack)

알람이 갈 Slack 채널은 조직 트리의 스코프(고객사 › 프로젝트 › 서비스)에 붙인다. 담당자 배정과 같은 상속 — **가장 구체적인
스코프에 채널이 하나라도 있으면 그 목록이 통째로**, 없으면 상위, 어디에도 없으면 전사 기본(`SLACK_DEFAULT_CHANNEL` → `SLACK_WEBHOOK_URL`).
한 스코프에 여러 채널을 둘 수 있다(예: 고객사 공유 채널 + 내부 온콜).

| 종류 | 언제 | 준비 |
|---|---|---|
| 우리 Slack 채널(봇) | 우리 워크스페이스에 만든 채널, Slack Connect 공유 채널 | `SLACK_BOT_TOKEN`, 비공개 채널이면 `/invite @alert-hub` |
| 고객사 웹훅 URL | 고객사가 자기 워크스페이스에서 Incoming Webhook 을 발급해 준 경우 | URL 만 |

각 채널에 "테스트 메시지" 버튼이 있고 마지막 성공/실패가 남는다. 다이제스트·점검 종료 요약·에스컬레이션도 같은 채널로 가며,
봇이 있으면 에스컬레이션 당사자에게 DM 도 간다. 라우팅 규칙(누구)과 통지 채널(어디)은 독립이다.

### Slack 에서 바로 처리 (버튼 · 스레드)

봇으로 나간 메시지에는 **✓ 확인 (Ack) · 해결 (Resolve) · 1시간 뮤트 · alert-hub 에서 열기** 버튼이 붙는다.
웹훅(외부 워크스페이스) 메시지는 인터랙션이 우리 앱으로 오지 않으므로 텍스트 + 링크만 간다.

- 누른 사람은 Slack ID 로 인원과 매칭한다. 활성 인원이 아니거나 조회 권한이면 본인에게만 보이는 안내를 주고 아무것도 바꾸지 않는다.
  SSO 로그인 시 Slack ID 가 자동 연결되므로 내부 인원은 보통 바로 된다.
- 전이는 알람 상세 버튼과 같은 경로(`transitionAlert`)를 지난다. 가드된 갱신이라 두 사람이 동시에 눌러도 한 번만 바뀌고, 이벤트에 `Ack (Slack 버튼) · 김도윤` 으로 남는다.
- 상태가 바뀌면(웹 · Slack · 공급자 OK 어디서든) 이 알람으로 나간 **봇 메시지 전부**의 상태 줄과 버튼이 갱신되고 스레드에 "✓ 김도윤 님이 확인했습니다 (Slack)" 한 줄이 남는다.
  메시지 좌표는 `SlackMessage` 에 저장된다.
- 뮤트 버튼은 이 알람만 1시간 조용히 한다(점검 · 뮤트 화면에 `Slack 뮤트 (1시간) · 이름` 으로 보인다).
- 묶음 통지(같은 서비스 알람 여러 건을 한 메시지로)에는 버튼이 없고 알람별 링크만 있다. 창 안에 한 건이면 평소 단건 메시지로 나가 버튼이 붙는다.

설정: Slack 앱 › **Interactivity & Shortcuts** 켜기 → Request URL `https://<APP_URL>/api/slack/interactive` → Basic Information 의
Signing Secret 을 `SLACK_SIGNING_SECRET` 으로. 봇 scope 에 `users:read` 가 필요하다(누른 사람 이름). 진단 화면의 "Slack 버튼" 행이 상태를 보여 준다.

### 고객사 포털 권한 (읽기 기본 · MSP 가 고객사마다 허용)

고객사 계정이 로그인하면 헤더에 **`<고객사명> 정보`**(읽기 전용) 또는 **`<고객사명> 설정`**(쓰기 권한이 하나라도 있을 때) 탭이 뜬다.
**기본값은 전부 읽기 전용**이고, MSP 관리자가 조직 트리 › 고객사 패널 › "담당자 로그인 · 권한"에서 항목별로 켠다.

| 권한 | 켜면 할 수 있는 것 |
|---|---|
| 담당자 관리 | 자기 회사 담당자 추가·수정·비활성 (역할은 항상 조회 전용) |
| 점검 창 등록 | 자기 회사 범위 점검 창 등록·해제 |
| Slack 채널 관리 | 자기 회사 통지 채널 등록·테스트·켜기끄기·삭제 |

담당 순서 · 팀 · 라우팅 규칙 · 프로젝트/서비스/AWS 계정 매핑은 **어떤 권한을 줘도 고객사가 바꿀 수 없다**(MSP 전용, 읽기만).

**위조 요청 방어 — 세 겹** (`src/server/portal.ts`):

1. **고객사 계정인가**: 포털 액션은 관리자 액션을 재사용하지 않는 별도 함수다. 내부 인원·관리자는 `requirePortal()` 을 통과하지 못한다.
2. **그 권한이 켜져 있나**: 폼이 안 보이는 것은 방어가 아니다. 액션이 매번 `Customer.portalGrants` 를 다시 읽는다.
3. **대상이 우리 회사 것인가**: 고객사 id 는 **세션에서만** 온다(폼의 `customerId` 는 읽지 않는다). 대상 행은 `assertOwned*()` 가 DB 에서 다시 읽어 주인을 확인하고, 남의 것이면 없는 것과 같은 거부다.

고객사가 바꾼 것은 `AuditLog` 에 남고 포털의 "최근 변경"과 함께 보인다. 거부 사유는 화면 상단의 빨간 띠로 돌려준다.

### 테넌트 스코프 (담당 고객사만 보기)

SSO 모드에서 내부 인원이 보는 범위:

| 누가 | 보는 것 |
|---|---|
| 관리자(ADMIN) · "전체 보기" 체크된 인원 | 모든 고객사 + 미매핑 알람 |
| 온콜·조회 | 직접 배정 + 팀 경유 배정이 걸린 고객사의 알람만 (어느 레벨에 배정돼도 고객사로 올라간다) |
| 배정이 없는 인원 | 아무 알람도 안 보임 — 배정을 받거나 "전체 보기"를 켠다 |

- 대시보드 목록·고객사/프로젝트 드롭다운·알람 상세·Ack/Resolve/뮤트·점검 창 등록·Slack 버튼이 모두 같은 판정을 쓴다. 범위 밖 알람 상세는 `/denied` 로.
- 알람에 `customerId` 를 비정규화해 두고(스냅샷 체인의 고객사) 그 열로 거른다. 배포 시 시드 스크립트가 빈 값을 스냅샷에서 멱등 백필한다.
- "전체 보기"는 계정 · 접근의 내부 인원 목록에서 관리자가 켠다(관제·리드용). open 모드(SSO 꺼짐)는 지금처럼 전부 보인다.
- 고객사 담당자 로그인(자기 고객사만 보는 외부 계정)은 아직 없다 — 지금은 내부 인원만 로그인한다.

### 가입 방식 · 승인

- **가입 방식 스위치**: 등록 관리 › **계정 · 접근** › "가입 방식"에서 **승인제 / 자동 승인**을 고른다. 화면 값이 `AUTH_AUTO_APPROVE` 환경변수보다 우선하고 DB(`Setting`)에 남는다.
- **승인 대기 목록**: 같은 화면(항상 보임). 내부 인원은 역할을 고르고 승인, 고객사 담당자는 "고객사 · 이름" 배지와 함께 조회 전용으로 승인. 거절도 여기서.
- 인원 목록의 각 행에 `승인: 자동` / `승인: 관리자이름` 이 남아 어떻게 활성이 됐는지 알 수 있다.
- 부트스트랩 관리자(`AUTH_BOOTSTRAP_ADMINS`)와 관리자가 미리 등록한 인원(=초대)은 어느 방식이든 바로 활성.

### 고객사 담당자 로그인 (외부 계정)

고객사 패널의 **담당자 로그인**에 허용 도메인(예 `homenic.co.kr`)을 넣으면, 그 도메인의 Google 계정이 SSO 로 들어와
그 고객사 소속 **조회 전용** 계정이 된다.

- 보는 것: 자기 고객사 알람만(대시보드·상세·이전 처리·런북)과 고객사 화면(`/portal`: 프로젝트 › 서비스 › AWS 계정과 담당 순서, 담당자, Slack 채널, 점검 창, 런북, 최근 변경).
  Ack/Resolve/뮤트 버튼은 비활성, 등록 관리 탭 대신 `<고객사명> 정보/설정` 탭, Slack 버튼도 거부. 쓰기는 위 "고객사 포털 권한"을 따른다.
  관리자는 `/portal?customer=<id>` 로 같은 화면을 읽기 전용으로 미리 본다.
- 가입: 내부 인원과 같은 승인 정책. 처음 로그인하면 가입 승인 대기에 "고객사 · 홈닉" 표시로 올라오고(자동 승인이면 바로 활성), 역할은 항상 조회.
  관리자가 미리 등록해 둔 담당자(이메일 일치)는 그 행에 붙는다 = 초대.
- 같은 이메일이 다른 고객사에 등록돼 있으면 거부한다. 도메인을 비우면 이미 발급된 세션도 다음 요청부터 막힌다.
- 내부 허용 목록(`AUTH_ALLOWED_DOMAINS` · `AUTH_ALLOWED_EMAILS`)이 먼저다 — 거기 있으면 내부 인원, 없으면 고객사 도메인을 본다.

### 런북 · CloudWatch 딥링크

서비스와 라우팅 규칙에 **런북**(링크 + markdown 본문)을 둔다. 규칙 런북이 있으면 그 규칙에 걸린 알람은 규칙 런북이 우선(더 구체적).

- Slack 알람 본문 마지막 줄: `📖 런북 (서비스 이체API)  ·  🔎 CloudWatch 콘솔`. 에스컬레이션 메시지에도 붙는다.
- 알람 상세 "런북 · 콘솔" 카드: 같은 링크 + 런북 본문 펼치기. 본문은 이후 AI 메모가 인용하는 재료다(링크만 있으면 LLM 이 읽을 수 없다).
- CloudWatch 콘솔 URL 은 지문(`cw:<AlarmArn>`)에서 리전·알람 이름을 뽑아 만든다. 콘솔은 로그인된 AWS 계정으로 열리므로 MSP 는 그 고객사 계정으로 스위치한 뒤 눌러야 한다.
- 편집: 조직 트리 › 서비스 패널의 "런북" 섹션, 라우팅 규칙 행의 "📖 런북" 펼치기(규칙 생성 폼에도 링크 칸).

### 해결 기록 · 이전 처리 (사실 층)

알람이 RESOLVED 로 갈 때마다 `Resolution` 행이 자동으로 남는다 — 사람이 닫았든(`manual`) 공급자 OK 로 저절로 풀렸든(`auto`).
**사람이 타이핑하는 칸은 없다.** 담기는 것: 발화 → 해결 소요 시간, 누가 ack/resolve, 에스컬레이션 몇 단계까지, 뮤트 여부,
24시간 안 재발 여부(재발 = "그 조치는 오답" 신호), 그리고 한 번 클릭 분류.

- **한 번 클릭 분류**: 사람이 닫으면 Slack 스레드에 `재시작 · 설정/용량 변경 · 저절로 회복 · 기타` 버튼이 붙는다. 하나 누르면 끝.
  알람 상세에도 같은 라디오(+ 선택 메모)가 있다. 자동 회복은 `auto` 로 미리 채워져 묻지 않는다.
- **꺼내 쓰기**: 같은 고객사 안에서 서비스+메트릭+리소스 → 서비스+메트릭 → 서비스 순으로 가까운 5건.
  알람 상세의 "이전 처리" 카드와 Slack 알람 본문의 `🕘` 한 줄(`지난 4건 · 자동 회복 3 · 재시작 1 · 중간 12분 · 최근: …`)에 보인다.
  기록이 없으면 "이전 처리 기록 없음 · 처음 보는 알람"이라고 말한다 — 이것도 힌트다.
- 고객사 밖의 기록은 근거로 쓰지 않는다. 이후 AI 메모(docs/aiops-market.md 5·7절)는 이 표를 그대로 재료로 쓴다.

### 통지 채널 확인 (도달 확인)

값이 등록됐다고 "연결됨"이라 하지 않는다. 채널마다 **미등록 → 확인 필요 → 요청됨 → 확인됨(시각 · 방식)** 이고, 확인 방식은
넷이다.

| 방식 | 언제 | 기록 |
|---|---|---|
| SSO 보증 | 로그인한 계정의 이메일 (Google 이 검증) | `sso` |
| Slack 매칭 | 로그인 시 이메일로 Slack ID 자동 연결 (`users:read.email`) | `slack-lookup` |
| 본인 코드 | 내 프로필에서 6자리 코드 받아 입력 (Slack DM · 이메일 · 문자) | `code` |
| 관리자 대리 | 인원 목록에서 "확인 요청 보내기" → 24시간 링크(`/verify/<token>`) 클릭, 또는 전화 확인 후 "수동 확인" + 메모 | `link` / `admin:<이름>` |

관리자 대리 방식은 로그인하지 않는 **고객사 담당자**를 위한 것이다. 링크 토큰은 해시로만 저장되고 1회용이다.
값(Slack ID·이메일·전화)이 바뀌면 그 채널의 확인 상태는 리셋된다. 전화번호는 저장 시 E.164(+82…)로 정규화한다.
발송 파이프가 없는 채널은 버튼이 "서버 미설정"으로 잠기고, 시스템 진단(등록 관리 › 시스템 진단)에 Slack 봇·SMTP·SMS 공급자 행이 보인다.

**발송 파이프와 비용(2026-09 기준, VAT 별도)**

| 채널 | 권장 | 비용 | 준비 |
|---|---|---|---|
| Slack | 봇 토큰 (구현됨) | 무료 | Slack 앱 1개 |
| 이메일 | Amazon SES (SMTP 인터페이스, 코드 변경 없음) | 1,000통당 $0.10, 신규 계정은 12개월 월 3,000통 무료 | 도메인 인증(SPF/DKIM), 샌드박스 해제. 급하면 Google Workspace SMTP(요금 없음, 계정당 일 2,000통) |
| 문자 | 국내 공급자(솔라피) 어댑터 — **보류**, 결정은 [docs/oncall-paging.md](docs/oncall-paging.md) · Twilio 는 구현됨 | 솔라피 SMS 건당 약 13~18원(월 발송량 할인) · Twilio 한국 발신 건당 $0.0494(≈70원) · NCP SENS 는 콘솔 요금표 확인 | 국내 공급자는 발신번호 사전 등록(사업자·통신서비스 이용증명원) |

에스컬레이션 SMS 는 "미ack 10분 뒤 다음 순위 한 명"에게만 가므로, 고객사 5곳·월 300건 알람 기준 문자 100통 안팎 = 월 2천 원 미만이다.
이메일은 알람당 담당자 수만큼 과금(SES 는 수신자 단위)되어도 월 1달러가 안 된다. 실질 비용은 Slack 이 아니라 **문자 발신번호 등록 절차**다.

### 시간대 온콜 (시프트 · 대체 근무)

주간·야간·주말에 담당자가 다르면 사람 대신 **팀**을 배정하고 팀 안에서 시프트를 나눈다.
PagerDuty 의 스케줄 레이어 + restriction + override 를 축소한 것이다.

```
대체 근무 (기간)   >   시프트 (요일 · 시간 창, 겹치면 나중에 만든 것)   >   팀 기본 순서
```

- 시프트: 요일 마스크 + 시작·끝 시각 + 당번 순번. 끝이 시작보다 빠르면 자정을 넘는 창(18:00 → 09:00, 요일은 시작일 기준).
- 대체 근무: 휴가·교대 스왑용 1회성 덮어쓰기. 기간 동안 그 사람이 1순위.
- 이긴 레이어 뒤에 팀 나머지가 이어져(중복 제거) 당번이 못 받아도 에스컬레이션이 팀 안에서 계속된다.
- 시각은 **팀 시간대**(기본 Asia/Seoul)로 해석한다. 팀 화면에서 바꾼다.
- 팀 화면의 "지금 당번" 줄이 현재 해석 결과와 어느 레이어인지 보여 준다.
- 라우팅 규칙이 가리키는 팀도 같은 해석을 탄다. 수신 시점 스냅샷에 `shift` 라벨("야간", "대체 근무")이 남고 알람 상세에 배지로 보인다.
- 스냅샷은 수신 시점에 고정된다: 23:50 접수 알람이 00:10 에 에스컬레이션되면 접수 시점 당번 순서를 따른다.

사람에게 직접 붙인 배정은 시간과 무관하다. 교대 주기(매주 A→B→C 로 도는 로테이션)와 공휴일 달력은 아직 없다 —
지금은 요일 창과 대체 근무로 대신한다.

### 라우팅 규칙 (기능 축 온콜)

조직 트리(고객사 › 프로젝트 › 서비스)는 "가장 구체적인 단계의 순서 채택"으로 담당을 정한다. 프로젝트 단위로 온콜을 도는
고객사는 이것으로 충분하지만, 인프라팀·DB팀·야간 당직처럼 **기능 축**으로 도는 고객사는 조직 트리 고객사 패널의
**라우팅 규칙**을 쓴다.

- 규칙 = 조건(namespace · metric · severity · resource, 선택적으로 서비스 한정) → **팀**. 비운 조건은 와일드카드, `*` 글롭, 대소문자 무시.
- 우선순위 오름차순 첫 매치가 이기고, 매치가 없으면 트리 순서. 팀은 내부 공용 팀이거나 그 고객사 전용 팀.
- 매치되면 팀의 활성 멤버가 팀 순서대로 **순서를 통째로 대체**한다(트리 순서와 섞지 않는다). 스냅샷과 알람 상세에
  "라우팅 규칙 X → 팀 Y"로 남는다.
- 규칙 조회가 실패하거나 팀에 활성 멤버가 없으면 트리 순서로 통지한다 — 규칙은 통지를 막는 쪽으로 실패하지 않는다.

예) 네오위즈: `AWS/RDS → DB팀` (우선 10), `severity CRITICAL → 야간 당직` (우선 50). RDS의 CRITICAL은 DB팀이 받는다.

### Vercel 환경변수를 CLI로 넣기

대시보드 폼 대신 터미널에서 한 번에 등록한다("No environment variables were created" 같은 폼 문제를 피한다).

```bash
npm i -g vercel            # 또는 npx vercel …
vercel login && vercel link                 # 프로젝트당 한 번
cp .env.vercel.example .env.vercel          # 값 채우기 (git 무시 파일)
npm run env:push -- --deploy                # production 등록 + 재배포
```

같은 이름은 값이 갱신되고, 빈 값은 건너뛴다. `vercel env ls production`으로 확인.

### Google SSO · JIT 등록 (선택)

1. Google Cloud Console → APIs & Services → Credentials → **OAuth client ID (Web application)**.
   Authorized redirect URI에 `https://<host>/api/auth/callback` 추가.
2. Vercel 환경변수: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`(`openssl rand -base64 32`), `AUTH_ALLOWED_DOMAINS`(및/또는 `AUTH_ALLOWED_EMAILS`), `APP_URL`.
3. 배포 후 `/login`. 허용 목록의 계정이 처음 로그인하면 **내부 인원(Contact, customerId=null)으로 만들어지되 승인 대기(PENDING)** 상태다
   (`AUTH_AUTO_APPROVE=true`면 바로 활성). 관리자가 아직 없으면 첫 로그인이 관리자가 된다.
   `/pending`에서 관리자 승인을 기다리고(승인 요청 알림은 Slack 웹훅으로, 시간당 1회), 승인되면 `/welcome`(프로필 → 담당 범위 → 완료)로 안내되어
   Slack 멤버 ID·전화를 직접 채운다. 관리자가 계정 · 접근에서 **미리 등록한 이메일은 승인 없이 바로 활성**(초대와 같다).
4. **역할**: 관리자(등록 관리 전체·가입 승인) / 온콜 엔지니어(Ack·Resolve·점검 창·자기 프로필) / 조회 전용. 서버 액션마다
   `requireRole()`이 검사하므로 폼을 조작해도 권한 밖 작업은 거부된다. 등록 관리는 관리자 전용이고 나머지는 `/denied`로 간다.
   마지막 남은 관리자는 강등·비활성할 수 없다. 첫 관리자는 `AUTH_BOOTSTRAP_ADMINS`로 만든다.
5. 고객사 담당자 이메일, 허용 목록 밖 계정, **비활성**·**거절** 처리된 인원은 로그인이 거부된다.
   비활성은 계정 · 접근 → 내부 인원 → 수정 → "활성" 체크 해제: 배정·팀 소속은 남기되 순서 해석과 선택 목록에서 빠진다.
6. 로그인 오류는 사용자 언어와 참조 코드(`AU-xxxxx`)만 화면에 나가고, 원인은 서버 로그에 같은 코드로 남는다.
   환경변수 상태·허용 목록·미설정 경고는 관리자 전용 **등록 관리 › 시스템 진단** 화면에만 나타난다.

SSO가 연결되지 않은(open) 상태에서는 지금처럼 로그인 없이 열려 있고 모든 가드가 통과한다 — 헤더의 "SSO 미연결"과 진단 화면이 이를 알린다.
세션은 서명된 쿠키(7일)이며 서버 세션 테이블이 없다. 비활성·거절은 다음 요청에서 DB를 다시 확인해 즉시 끊긴다.
Ack·점검 창 등록 같은 액션은 세션의 이름을 남긴다(`Alert.ackedBy`, `Silence.createdBy`).

When `INGEST_TOKEN` is set, senders authenticate with **either** the
`x-webhook-token: <token>` header **or** a `?token=<token>` query parameter.
The query form exists because SNS and PagerDuty cannot attach custom headers —
bake the token into the subscription/webhook URL instead
(`https://<host>/api/webhooks/cloudwatch?token=...`).

> **Migration seam.** The ingest core (`normalizeWith` + `ingestAlerts`) is
> transport-agnostic, `prisma generate` already emits an Amazon-Linux engine
> (`binaryTargets`), and the pooled DB URL is serverless-ready — so EC2 → Lambda
> /Vercel later is mostly infra config, not an app rewrite.

## Webhook

The ingest is two layers — **transport** (how it arrives) × **provider** (payload
format):

- **Transport:** direct HTTPS POST, or an **SNS envelope** (`{ Type, TopicArn }`).
  `SubscriptionConfirmation` is auto-confirmed by fetching `SubscribeURL`;
  `Notification` has its `Message` (a JSON string) peeled and parsed.
- **Provider:** the URL segment selects the parser.

```
POST /api/webhooks/cloudwatch    CloudWatch alarm JSON (usually via SNS)
POST /api/webhooks/prometheus    Alertmanager webhook (batch: alerts[])
POST /api/webhooks/grafana       Grafana unified alerting (legacy best-effort)
POST /api/webhooks/pagerduty     PagerDuty v3 webhook (v2 best-effort)
POST /api/webhooks/generic       title|name + optional fields
POST /api/webhooks/alarm         auto-detect (sniffs the payload shape)
```

Each provider lives behind one `Provider` interface (`src/lib/providers/*`) and
maps its payload onto the common `NormalizedAlert`. Prometheus/Grafana send a
**batch** per POST, so a single request can create many alerts. Adding a source
is just adding a provider file — nothing downstream changes.

> **PoC target generations:** Grafana unified (8+), Alertmanager `version:"4"`,
> PagerDuty v3. Older generations (Grafana legacy `evalMatches`, PagerDuty v2
> `messages[]`) are detected and parsed best-effort.
>
> **Auth:** three independent layers. `INGEST_TOKEN` (header or `?token=`)
> gates every route when set. SNS envelopes are **signature-verified by
> default** (`SNS_VERIFY=false` to opt out) — the signing cert must come from
> `sns.<region>.amazonaws.com` and nothing in the envelope (SubscribeURL
> included) is trusted before the signature checks out. With
> `PAGERDUTY_WEBHOOK_SECRET` set, PagerDuty requests must carry a valid
> `X-PagerDuty-Signature` (v1 HMAC over the raw body). Bodies over 1MB are
> rejected.

### Deduplication

Alerts upsert on `fingerprint`:

- CloudWatch → `cw:<AlarmArn>`
- Prometheus/Grafana → `<source>:<native fingerprint>` (falls back to
  `<source>:<alertname>:<resource>`)
- PagerDuty → `pagerduty:<incident.id>`
- Generic → `<source>:<title>:<resource>`

Same fingerprint ⇒ the alert is updated and an `AlertEvent` is appended.
`count` increments **only** on a transition **into** FIRING, and notifications
(Slack + email, whichever is configured) fire on that same transition.
While an alert is ACKNOWLEDGED, provider re-sends of the still-firing alarm
neither flip the status back nor re-notify — only a resolve/OK does.

## 자동 에스컬레이션 (Phase 3)

`GET /api/cron/escalate` walks every FIRING alert: if nobody acked within
`ESCALATION_ACK_MINUTES` (default 10) since the fire (or the previous
escalation), the **next person** in the alert's frozen 수신 시점 스냅샷 order is
notified via the same channels, and an `ESCALATED` event lands on the timeline.
The endpoint requires `CRON_SECRET` (`Authorization: Bearer …` or `?secret=`)
and must be driven by an external scheduler, e.g.:

```cron
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/escalate
```

Ack(또는 resolve) 하는 순간 사다리는 멈춘다. 재발화는 새 인시던트로 취급되어
1순위부터 다시 시작한다.

채널별 강도는 사다리를 따른다: 최초 FIRING은 Slack + email, 에스컬레이션부터는
같은 두 채널에 더해 Twilio SMS(설정 시 전화까지)가 다음 순위 한 명에게 나간다.

## Org model & admin (Phase 2a)

`/admin` manages the multi-tenant master data (see `docs/org-model.md` for the
full design):

```
Customer(고객사) > Project > Service > AwsAccountMap(accountId, environment)
Contact(사람 마스터)  +  Assignment(사람 × 스코프 × 정/부/멤버)
```

- Ownership attaches to **any** level; resolution is "closest wins with
  inheritance" (account → service → project → customer), so each customer's
  management style (project-led, service-led, mixed) is just data.
- Attach/detach = add/remove an Assignment row via dropdown chips; each scope
  page shows a **roster rollup** (direct people + people from descendants).
- The `AwsAccountMap.accountId` matches the account id parsed from incoming
  alarm ARNs — Phase 2b enriches alerts with the resolved chain + owner
  snapshot and adds dashboard filters.

## Tests

```bash
npm test          # vitest: provider parsers, ingest logic (Prisma mocked), webhook route
```

No database needed — the suite covers payload normalization for all five
providers (including version-generation edge cases), dedup/transition semantics
(sparse updates must not erase enrichment; count++/notify only on transitions
into FIRING; create races), and route behavior (token auth, SSRF guard on
`SubscribeURL`, SNS envelope peeling, body cap).

## curl tests

Start the server (`npm run dev`) first. Add `-H "x-webhook-token: <token>"` if
`INGEST_TOKEN` is set.

**1. Generic alert (creates a FIRING alert, notifies Slack):**

```bash
curl -sS -X POST http://localhost:3000/api/webhooks/alarm \
  -H 'content-type: application/json' \
  -d '{
    "title": "Checkout latency high",
    "severity": "SEV-2",
    "source": "custom",
    "resource": "checkout-svc",
    "metric": "p99_latency_ms",
    "reason": "p99 latency 1200ms > 800ms"
  }'
```

**2. CloudWatch alarm (ALARM ⇒ FIRING):**

```bash
curl -sS -X POST http://localhost:3000/api/webhooks/cloudwatch \
  -H 'content-type: application/json' \
  -d '{
    "AlarmName": "SEV-1 prod-db CPU",
    "AlarmDescription": "Database CPU too high",
    "NewStateValue": "ALARM",
    "NewStateReason": "Threshold Crossed: CPUUtilization > 90",
    "AlarmArn": "arn:aws:cloudwatch:us-east-1:123456789012:alarm:prod-db-cpu",
    "Region": "US East (N. Virginia)",
    "Trigger": {
      "MetricName": "CPUUtilization",
      "Namespace": "AWS/RDS",
      "Threshold": 90,
      "ComparisonOperator": "GreaterThanThreshold",
      "Dimensions": [{ "name": "DBInstanceIdentifier", "value": "prod-db" }]
    }
  }'
```

**3. Resend the same alarm as OK ⇒ transitions to RESOLVED** (same fingerprint,
new event appended, no count bump, no re-notify):

```bash
curl -sS -X POST http://localhost:3000/api/webhooks/cloudwatch \
  -H 'content-type: application/json' \
  -d '{
    "AlarmName": "SEV-1 prod-db CPU",
    "NewStateValue": "OK",
    "NewStateReason": "Threshold no longer crossed",
    "AlarmArn": "arn:aws:cloudwatch:us-east-1:123456789012:alarm:prod-db-cpu"
  }'
```

**4. Prometheus / Alertmanager (batch of two alerts in one POST):**

```bash
curl -sS -X POST http://localhost:3000/api/webhooks/prometheus \
  -H 'content-type: application/json' \
  -d '{
    "version": "4",
    "status": "firing",
    "groupKey": "{}:{alertname=\"HighErrorRate\"}",
    "alerts": [
      {
        "status": "firing",
        "labels": { "alertname": "HighErrorRate", "severity": "critical", "instance": "api-1:9090", "job": "api" },
        "annotations": { "summary": "5xx rate high", "description": "error rate 12% > 5%" },
        "fingerprint": "a1b2c3"
      },
      {
        "status": "firing",
        "labels": { "alertname": "HighLatency", "severity": "warning", "instance": "api-2:9090" },
        "annotations": { "description": "p99 900ms > 500ms" },
        "fingerprint": "d4e5f6"
      }
    ]
  }'
```

**5. PagerDuty v3 webhook (incident triggered ⇒ FIRING; acknowledged ⇒ ACKNOWLEDGED):**

```bash
curl -sS -X POST http://localhost:3000/api/webhooks/pagerduty \
  -H 'content-type: application/json' \
  -d '{
    "event": {
      "event_type": "incident.triggered",
      "data": {
        "id": "PABC123",
        "title": "API is down",
        "status": "triggered",
        "urgency": "high",
        "priority": { "summary": "P1" },
        "service": { "summary": "checkout-api" }
      }
    }
  }'
```

**6. Grafana unified alerting:**

```bash
curl -sS -X POST http://localhost:3000/api/webhooks/grafana \
  -H 'content-type: application/json' \
  -d '{
    "status": "firing",
    "version": "1",
    "orgId": 1,
    "alerts": [
      {
        "status": "firing",
        "labels": { "alertname": "DiskAlmostFull", "severity": "warning", "instance": "web-3" },
        "annotations": { "summary": "disk 92%" },
        "fingerprint": "g7h8i9",
        "valueString": "92",
        "dashboardURL": "https://grafana.example.com/d/abc"
      }
    ]
  }'
```

Open <http://localhost:3000> to see the cards, status filter, severity badges,
the table, and each alert's event timeline.

## Wiring up real AWS

1. On a CloudWatch alarm, set **AlarmActions** → an **SNS topic** (same region
   as the alarm). For multi-account collection, give the topic a resource
   policy allowing the source accounts to `sns:Publish` (scope with
   `aws:SourceAccount`).
2. Add an **HTTPS subscription** on that topic pointing at your deployed
   `https://<host>/api/webhooks/cloudwatch`.
3. SNS sends a `SubscriptionConfirmation`; alert-hub auto-confirms it by fetching
   `SubscribeURL`. After that, alarm state changes arrive as `Notification`
   envelopes and land on the dashboard (and Slack).

Other sources point their webhooks at the matching route
(`/api/webhooks/prometheus`, `/grafana`, `/pagerduty`) — or `/api/webhooks/alarm`
to let the payload be auto-detected.

## Roadmap (next slices)

- **Ingest:** per-source signature verification (SNS message signatures,
  PagerDuty `X-PagerDuty-Signature`); more providers behind the same interface.
- **Product:** AI 메모(해결 기록 + 런북 근거, [docs/aiops-market.md](docs/aiops-market.md) 5·7절)
  (온콜이 담당 고객사만) → 온콜 호출 사다리(문자·전화, 솔라피 — 조사 완료·보류,
  [docs/oncall-paging.md](docs/oncall-paging.md)).

Each is additive on top of this MVP's provider interface, notifier interface,
explicit status transitions, and append-only event history.
