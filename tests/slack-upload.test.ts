import { describe, expect, it } from "vitest";
import { uploadImageToThread } from "@/lib/notify/slack-api";

// 그래프 PNG 를 알람 메시지 스레드에 올리는 Slack 업로드 3단계.

describe("Slack 이미지 업로드", () => {
  it("URL 받기 → 업로드 → 스레드에 완료 (form-urlencoded)", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const calls: { url: string; body: string; type: string | null }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: typeof init.body === "string" ? init.body : "<bytes>", type: new Headers(init.headers).get("content-type") });
      if (String(url).endsWith("files.getUploadURLExternal")) return new Response(JSON.stringify({ ok: true, upload_url: "https://files.slack.test/up", file_id: "F1" }));
      if (String(url) === "https://files.slack.test/up") return new Response("OK");
      return new Response(JSON.stringify({ ok: true }));
    }) as unknown as typeof fetch;
    await uploadImageToThread({ channel: "C1", ts: "1.1" }, new Uint8Array([1, 2, 3]), { filename: "g.png", title: "📈 그래프" }, fetchImpl);
    expect(calls.map((c) => c.url)).toEqual([
      "https://slack.com/api/files.getUploadURLExternal",
      "https://files.slack.test/up",
      "https://slack.com/api/files.completeUploadExternal",
    ]);
    expect(calls[0].body).toBe("filename=g.png&length=3");
    expect(calls[0].type).toBe("application/x-www-form-urlencoded");
    const done = new URLSearchParams(calls[2].body);
    expect(JSON.parse(done.get("files")!)).toEqual([{ id: "F1", title: "📈 그래프" }]);
    expect(done.get("channel_id")).toBe("C1");
    expect(done.get("thread_ts")).toBe("1.1");
  });
  it("files:write 가 없으면 고칠 곳을 말한다", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const fetchImpl = (async () => new Response(JSON.stringify({ ok: false, error: "missing_scope" }))) as unknown as typeof fetch;
    await expect(uploadImageToThread({ channel: "C1", ts: "1" }, new Uint8Array([1]), { filename: "g.png", title: "t" }, fetchImpl)).rejects.toThrow(/files:write/);
  });
});

