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
| `SLACK_WEBHOOK_URL` | no       | Slack Incoming Webhook. Unset ⇒ Slack notifications skipped. |
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

### 실제 고객사 투입 전 체크리스트

1. **데모 데이터 정리** — 운영 DB에서 `npm run demo:reset`(먼저 인자 없이 돌려 목록 확인, `--yes`로 삭제).
   Vercel에서는 `DATABASE_URL`을 로컬 셸에 넣고 실행하면 된다. 시드 데모 고객사·알람·내부 데모 인원만 지운다.
2. **`SEED_DEMO=false`** 를 Vercel 환경변수에 추가 — 빈 DB에 배포하면 데모 시드가 다시 들어가는 것을 막는다.
3. **`INGEST_TOKEN`**, **`CRON_SECRET`** 설정. 웹훅 URL에는 `?token=`으로 박는다(SNS는 헤더를 못 붙인다).
4. **SSO**(아래) — 실제 고객사 알람이 보이는 화면을 URL만으로 열어 두지 않는다.
5. 외부 스케줄러(cron-job.org, QStash 등)로 `/api/cron/notify`·`/api/cron/escalate`를 1분 간격 호출.
6. 조직 트리 → **새 고객사 온보딩**으로 고객사 › 프로젝트 › 서비스 › AWS 계정 매핑 › 담당자를 만들고,
   고객사 AWS 계정마다 SNS 토픽 → HTTPS 구독(`/api/webhooks/cloudwatch?token=…`) → CloudWatch 알람 액션을 건다.
   구독 확인은 자동, SNS 서명 검증은 기본 켜짐.

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

### Google SSO · JIT 등록 (선택)

1. Google Cloud Console → APIs & Services → Credentials → **OAuth client ID (Web application)**.
   Authorized redirect URI에 `https://<host>/api/auth/callback` 추가.
2. Vercel 환경변수: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`(`openssl rand -base64 32`), `AUTH_ALLOWED_DOMAINS`(및/또는 `AUTH_ALLOWED_EMAILS`), `APP_URL`.
3. 배포 후 `/login`. 처음 로그인하는 회사 도메인 계정은 **내부 인원(Contact, customerId=null)으로 자동 등록**되고
   `/me`(내 통지 프로필)로 안내되어 Slack 멤버 ID·전화를 직접 채운다. 이미 같은 이메일의 내부 인원이 있으면 그 행에 연결된다.
4. 고객사 담당자 이메일, 허용 도메인 밖 계정, **비활성** 처리된 인원은 로그인이 거부된다.
   비활성은 팀 · 내부 인원 → 수정 → "활성" 체크 해제: 배정·팀 소속은 남기되 순서 해석과 선택 목록에서 빠진다.

세션은 서명된 쿠키(7일)이며 서버 세션 테이블이 없다. 비활성 처리는 다음 요청에서 DB의 `active`를 다시 확인해 즉시 끊긴다.
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
- **Product:** email channel → ack/resolve actions → on-call/escalation →
  Twilio SMS/voice paging.

Each is additive on top of this MVP's provider interface, notifier interface,
explicit status transitions, and append-only event history.
