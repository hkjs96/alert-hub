import { describe, expect, it } from "vitest";
import { normalizeWith } from "@/lib/providers";
import { extractSeverity, mapFiringStatus } from "@/lib/normalize";

const CW_ALARM = {
  AlarmName: "SEV-1 prod-db CPU",
  AlarmDescription: "CPU high",
  NewStateValue: "ALARM",
  NewStateReason: "Threshold Crossed",
  AlarmArn: "arn:aws:cloudwatch:us-east-1:123456789012:alarm:prod-db-cpu",
  Trigger: {
    MetricName: "CPUUtilization",
    Namespace: "AWS/RDS",
    Threshold: 90,
    ComparisonOperator: "GreaterThanThreshold",
    Dimensions: [{ name: "DBInstanceIdentifier", value: "prod-db" }],
  },
};

describe("cloudwatch provider", () => {
  it("normalizes an ALARM payload", () => {
    const { provider, alerts } = normalizeWith("cloudwatch", CW_ALARM);
    expect(provider).toBe("cloudwatch");
    expect(alerts).toHaveLength(1);
    const a = alerts[0];
    expect(a.status).toBe("FIRING");
    expect(a.severity).toBe("SEV-1");
    expect(a.fingerprint).toBe(
      "cw:arn:aws:cloudwatch:us-east-1:123456789012:alarm:prod-db-cpu",
    );
    expect(a.accountId).toBe("123456789012");
    expect(a.region).toBe("us-east-1");
    expect(a.metric).toBe("CPUUtilization");
    expect(a.namespace).toBe("AWS/RDS");
    expect(a.threshold).toBe(90);
    expect(a.comparison).toBe("GreaterThanThreshold");
    expect(a.resource).toBe("DBInstanceIdentifier=prod-db");
  });

  it("keeps the same fingerprint across state changes (dedup key stability)", () => {
    const firing = normalizeWith("cloudwatch", CW_ALARM).alerts[0];
    const ok = normalizeWith("cloudwatch", {
      AlarmName: CW_ALARM.AlarmName,
      NewStateValue: "OK",
      AlarmArn: CW_ALARM.AlarmArn,
    }).alerts[0];
    expect(ok.status).toBe("RESOLVED");
    expect(ok.fingerprint).toBe(firing.fingerprint);
  });

  it("maps INSUFFICIENT_DATA through unchanged", () => {
    const a = normalizeWith("cloudwatch", {
      AlarmName: "x",
      NewStateValue: "INSUFFICIENT_DATA",
    }).alerts[0];
    expect(a.status).toBe("INSUFFICIENT_DATA");
  });
});

describe("prometheus provider", () => {
  const AM_PAYLOAD = {
    version: "4",
    status: "firing",
    groupKey: '{}:{alertname="HighErrorRate"}',
    alerts: [
      {
        status: "firing",
        labels: {
          alertname: "HighErrorRate",
          severity: "critical",
          instance: "api-1:9090",
          job: "api",
        },
        annotations: { description: "err 12%" },
        fingerprint: "a1b2c3",
      },
      {
        status: "resolved",
        labels: { alertname: "HighLatency", severity: "warning", instance: "api-2:9090" },
        annotations: { description: "p99 ok" },
        fingerprint: "d4e5f6",
      },
    ],
  };

  it("auto-detects and parses a batch", () => {
    const { provider, alerts } = normalizeWith("alarm", AM_PAYLOAD);
    expect(provider).toBe("prometheus");
    expect(alerts).toHaveLength(2);
    expect(alerts[0].fingerprint).toBe("prometheus:a1b2c3");
    expect(alerts[0].severity).toBe("CRITICAL");
    expect(alerts[0].resource).toBe("api-1:9090");
    expect(alerts[1].status).toBe("RESOLVED");
  });
});

describe("grafana provider", () => {
  const GRAFANA_UNIFIED = {
    status: "firing",
    version: "1",
    orgId: 1,
    alerts: [
      {
        status: "firing",
        labels: { alertname: "DiskFull", severity: "warning", instance: "web-3" },
        annotations: { summary: "disk 92%" },
        fingerprint: "g7",
        valueString: "92",
        dashboardURL: "https://grafana.example.com/d/abc",
      },
    ],
  };

  it("auto-detects unified alerting (NOT prometheus, despite the shared shape)", () => {
    const { provider, alerts } = normalizeWith("alarm", GRAFANA_UNIFIED);
    expect(provider).toBe("grafana");
    expect(alerts[0].source).toBe("grafana");
    expect(alerts[0].fingerprint).toBe("grafana:g7");
    expect(alerts[0].value).toBe("92");
  });

  it("parses legacy payloads best-effort", () => {
    const { provider, alerts } = normalizeWith("alarm", {
      title: "[Alerting] CPU alert",
      ruleName: "CPU alert",
      ruleId: 42,
      state: "alerting",
      message: "cpu is high",
      evalMatches: [{ metric: "cpu", value: 91 }],
    });
    expect(provider).toBe("grafana");
    expect(alerts[0].status).toBe("FIRING");
    expect(alerts[0].fingerprint).toBe("grafana:42");
  });

  it("maps legacy paused state to INSUFFICIENT_DATA, not FIRING", () => {
    const { alerts } = normalizeWith("grafana", {
      ruleName: "CPU alert",
      state: "paused",
    });
    expect(alerts[0].status).toBe("INSUFFICIENT_DATA");
  });
});

describe("pagerduty provider", () => {
  const PD_V3 = {
    event: {
      event_type: "incident.triggered",
      data: {
        id: "PABC123",
        title: "API down",
        status: "triggered",
        urgency: "high",
        priority: { summary: "P1" },
        service: { summary: "checkout-api" },
      },
    },
  };

  it("parses a v3 triggered event", () => {
    const { alerts } = normalizeWith("pagerduty", PD_V3);
    const a = alerts[0];
    expect(a.status).toBe("FIRING");
    expect(a.fingerprint).toBe("pagerduty:PABC123");
    expect(a.severity).toBe("P1");
    expect(a.resource).toBe("checkout-api");
  });

  it("maps acknowledged/resolved onto our lifecycle with a stable fingerprint", () => {
    const ack = normalizeWith("pagerduty", {
      event: { event_type: "incident.acknowledged", data: { id: "PABC123", title: "API down" } },
    }).alerts[0];
    const res = normalizeWith("pagerduty", {
      event: { event_type: "incident.resolved", data: { id: "PABC123", title: "API down" } },
    }).alerts[0];
    expect(ack.status).toBe("ACKNOWLEDGED");
    expect(res.status).toBe("RESOLVED");
    expect(ack.fingerprint).toBe("pagerduty:PABC123");
    expect(res.fingerprint).toBe("pagerduty:PABC123");
  });

  it("auto-detects v3 envelopes", () => {
    expect(normalizeWith("alarm", PD_V3).provider).toBe("pagerduty");
  });

  it("parses deprecated v2 messages[] best-effort", () => {
    const { alerts } = normalizeWith("pagerduty", {
      messages: [
        {
          event: "incident.trigger",
          data: { incident: { id: "P9", title: "old-style", urgency: "low" } },
        },
      ],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].fingerprint).toBe("pagerduty:P9");
    expect(alerts[0].status).toBe("FIRING");
  });
});

describe("generic provider + robustness", () => {
  it("falls through to generic on auto-detect", () => {
    const { provider, alerts } = normalizeWith("alarm", {
      title: "Checkout latency",
      severity: "SEV-2",
      source: "custom",
      resource: "checkout-svc",
      status: "firing",
    });
    expect(provider).toBe("generic");
    expect(alerts[0].fingerprint).toBe("custom:Checkout latency:checkout-svc");
  });

  it("returns zero alerts for garbage", () => {
    expect(normalizeWith("alarm", { foo: "bar" }).alerts).toHaveLength(0);
    expect(normalizeWith("alarm", null).alerts).toHaveLength(0);
    expect(normalizeWith("alarm", "text").alerts).toHaveLength(0);
  });

  it("returns zero alerts when a payload is forced through the wrong provider", () => {
    expect(normalizeWith("grafana", CW_ALARM).alerts).toHaveLength(0);
    expect(normalizeWith("cloudwatch", { title: "x" }).alerts).toHaveLength(0);
  });
});

describe("normalize helpers", () => {
  it("extracts SEV-n in various spellings", () => {
    expect(extractSeverity("SEV-1 db down")).toBe("SEV-1");
    expect(extractSeverity("sev2 latency")).toBe("SEV-2");
    expect(extractSeverity("Sev 3: minor")).toBe("SEV-3");
    expect(extractSeverity("no marker", "still none")).toBe("UNKNOWN");
    // "severity" the word must not match
    expect(extractSeverity("severity is high")).toBe("UNKNOWN");
  });

  it("maps firing-style statuses", () => {
    expect(mapFiringStatus("firing")).toBe("FIRING");
    expect(mapFiringStatus("alerting")).toBe("FIRING");
    expect(mapFiringStatus("resolved")).toBe("RESOLVED");
    expect(mapFiringStatus("ok")).toBe("RESOLVED");
    expect(mapFiringStatus("no_data")).toBe("INSUFFICIENT_DATA");
    expect(mapFiringStatus("paused")).toBe("INSUFFICIENT_DATA");
  });
});
