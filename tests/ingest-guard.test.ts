import { describe, expect, it } from "vitest";
import { checkAlert, checkSubscription, newIngestToken, topicAccountOf } from "@/lib/ingest-guard";

describe("수집 규칙", () => {
  it("주제 ARN 에서 계정", () => {
    expect(topicAccountOf("arn:aws:sns:ap-northeast-2:771283576189:alert-hub")).toBe("771283576189");
    expect(topicAccountOf("arn:aws:sns:us-east-1:123:t")).toBeNull();
    expect(topicAccountOf(null)).toBeNull();
  });
  it("직접 POST(서명 없음)는 고객사 토큰 일치만 본다", () => {
    expect(checkAlert({ alertAccount: "a", alertCustomer: "c1", fromSns: false, topicAccount: null, topicCustomer: null, tokenCustomer: null })).toEqual({ ok: true });
    expect(checkAlert({ alertAccount: "a", alertCustomer: "c1", fromSns: false, topicAccount: null, topicCustomer: null, tokenCustomer: "c2" }).ok).toBe(false);
  });
  it("공용 주소 구독은 수락, 고객사 주소 구독은 그 고객사 주제만", () => {
    expect(checkSubscription({ topicAccount: "x", topicCustomer: null, tokenCustomer: null })).toEqual({ ok: true });
    expect(checkSubscription({ topicAccount: "x", topicCustomer: "c1", tokenCustomer: "c1" })).toEqual({ ok: true });
    expect(checkSubscription({ topicAccount: "x", topicCustomer: null, tokenCustomer: "c1" }).ok).toBe(false);
  });
  it("토큰 형식", () => {
    expect(newIngestToken()).toMatch(/^in_[0-9a-f]{40}$/);
  });
});
