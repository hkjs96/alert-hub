import { describe, expect, it } from "vitest";
import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import {
  buildSnsCanonicalString,
  isSnsSigningCertUrl,
  verifyPagerDutySignature,
  verifySnsMessage,
  verifySnsSignature,
} from "@/lib/webhook-verify";

// 서명 검증의 순수 부분. 실제 AWS 인증서 대신 테스트가 만든 RSA 키쌍으로
// 서명하고 공개키 PEM을 인증서 자리에 주입한다 — 검증 코드는 PEM이 어디서
// 왔는지 모른다.

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicPem = publicKey.export({ type: "spki", format: "pem" }) as string;

function signedNotification(tamper?: (m: Record<string, string>) => void) {
  const msg: Record<string, string> = {
    Type: "Notification",
    MessageId: "m-1",
    TopicArn: "arn:aws:sns:us-east-1:123:alerts",
    Subject: "ALARM: cpu",
    Message: '{"AlarmName":"cpu"}',
    Timestamp: "2026-08-30T00:00:00.000Z",
    SignatureVersion: "1",
    SigningCertURL:
      "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem",
  };
  const signer = createSign("RSA-SHA1");
  signer.update(buildSnsCanonicalString(msg)!, "utf8");
  msg.Signature = signer.sign(privateKey, "base64");
  tamper?.(msg);
  return msg;
}

describe("buildSnsCanonicalString", () => {
  it("Notification은 고정 키 순서, Subject는 있을 때만 들어간다", () => {
    const withSubject = signedNotification();
    expect(buildSnsCanonicalString(withSubject)).toBe(
      `Message\n${withSubject.Message}\nMessageId\nm-1\nSubject\nALARM: cpu\n` +
        `Timestamp\n2026-08-30T00:00:00.000Z\nTopicArn\n${withSubject.TopicArn}\nType\nNotification\n`,
    );

    const { Subject: _omit, ...noSubject } = signedNotification();
    expect(buildSnsCanonicalString(noSubject)).not.toContain("Subject");
  });

  it("SubscriptionConfirmation은 SubscribeURL·Token을 포함한다", () => {
    const s = buildSnsCanonicalString({
      Type: "SubscriptionConfirmation",
      Message: "m",
      MessageId: "id",
      SubscribeURL: "https://sns.us-east-1.amazonaws.com/x",
      Timestamp: "t",
      Token: "tok",
      TopicArn: "arn",
    });
    expect(s).toContain("SubscribeURL\n");
    expect(s).toContain("Token\ntok\n");
  });

  it("모르는 Type은 null", () => {
    expect(buildSnsCanonicalString({ Type: "Whatever" })).toBeNull();
  });
});

describe("verifySnsSignature", () => {
  it("올바른 서명은 통과한다", () => {
    expect(verifySnsSignature(signedNotification(), publicPem).ok).toBe(true);
  });

  it("본문이 한 글자라도 바뀌면 실패한다", () => {
    const tampered = signedNotification((m) => {
      m.Message = '{"AlarmName":"cpu","injected":true}';
    });
    const r = verifySnsSignature(tampered, publicPem);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("signature mismatch");
  });

  it("서명이 없으면 실패한다", () => {
    const { Signature: _s, ...unsigned } = signedNotification();
    expect(verifySnsSignature(unsigned, publicPem).ok).toBe(false);
  });
});

describe("verifySnsMessage — SigningCertURL 가드", () => {
  it("SNS 도메인의 .pem만 허용한다", () => {
    expect(
      isSnsSigningCertUrl(
        "https://sns.ap-northeast-2.amazonaws.com/SimpleNotificationService-x.pem",
      ),
    ).toBe(true);
    expect(isSnsSigningCertUrl("https://evil.example.com/cert.pem")).toBe(false);
    expect(
      isSnsSigningCertUrl("https://sns.us-east-1.amazonaws.com.evil.com/c.pem"),
    ).toBe(false);
    expect(
      isSnsSigningCertUrl("http://sns.us-east-1.amazonaws.com/c.pem"),
    ).toBe(false);
    expect(isSnsSigningCertUrl("https://sns.us-east-1.amazonaws.com/c.txt")).toBe(false);
  });

  it("가짜 cert URL이면 fetch 없이 거절, 정상이면 주입된 fetch로 검증한다", async () => {
    const msg = signedNotification();

    const bad = await verifySnsMessage(
      { ...msg, SigningCertURL: "https://evil.example.com/c.pem" },
      async () => {
        throw new Error("must not be called");
      },
    );
    expect(bad).toMatchObject({ ok: false, reason: "invalid SigningCertURL" });

    const good = await verifySnsMessage(msg, async () => publicPem);
    expect(good.ok).toBe(true);
  });
});

describe("verifyPagerDutySignature", () => {
  const secret = "pd-secret";
  const body = '{"event":{"id":"e1"}}';
  const good = createHmac("sha256", secret).update(body).digest("hex");

  it("올바른 v1 서명은 통과, 로테이션 다중 서명 중 하나만 맞아도 된다", () => {
    expect(verifyPagerDutySignature(body, `v1=${good}`, secret).ok).toBe(true);
    expect(
      verifyPagerDutySignature(body, `v1=deadbeef, v1=${good}`, secret).ok,
    ).toBe(true);
  });

  it("헤더 없음·형식 불량·불일치는 각자의 이유로 실패한다", () => {
    expect(verifyPagerDutySignature(body, null, secret).reason).toBe(
      "missing X-PagerDuty-Signature",
    );
    expect(verifyPagerDutySignature(body, "v2=abc", secret).reason).toBe(
      "no v1 signature in header",
    );
    expect(verifyPagerDutySignature(body, "v1=deadbeef", secret).reason).toBe(
      "signature mismatch",
    );
  });

  it("바디가 바뀌면 실패한다", () => {
    expect(verifyPagerDutySignature(body + " ", `v1=${good}`, secret).ok).toBe(false);
  });
});
