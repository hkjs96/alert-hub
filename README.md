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
> **Auth:** `INGEST_TOKEN` (header or `?token=`) gates every route today.
> `SubscribeURL` is validated to point at a real `sns.<region>.amazonaws.com`
> host before it is fetched, and bodies over 1MB are rejected. Per-source
> signature verification (SNS message signatures, PagerDuty
> `X-PagerDuty-Signature`) is the next step.

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
