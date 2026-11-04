import { afterEach, describe, expect, it } from "vitest";
import { appUrl } from "@/lib/app-url";

// 공개 주소: APP_URL 이 없어도 Vercel 운영 도메인으로 — Slack 버튼·그래프가 이 값에 달려 있다.
describe("appUrl", () => {
  afterEach(() => {
    delete process.env.APP_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  });
  it("APP_URL 우선, 끝 / 제거", () => {
    process.env.APP_URL = " https://hub.example/ ";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "other.vercel.app";
    expect(appUrl()).toBe("https://hub.example");
  });
  it("없으면 Vercel 운영 도메인", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "alert-hub-rho.vercel.app";
    expect(appUrl()).toBe("https://alert-hub-rho.vercel.app");
  });
  it("둘 다 없으면 null", () => {
    expect(appUrl()).toBeNull();
  });
});
