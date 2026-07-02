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

```bash
npm install
cp .env.example .env        # set DATABASE_URL + DIRECT_URL (and SLACK_WEBHOOK_URL)
npx prisma generate
npx prisma db push          # create the tables in your Postgres
npm run dev                 # http://localhost:3000
```

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
`count` increments **only** on a transition **into** FIRING, and Slack fires on
that same transition (skipped if `SLACK_WEBHOOK_URL` is unset).

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
