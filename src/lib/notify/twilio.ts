import type { Notifier, NotifyContext } from "@/lib/notify";
import type { NormalizedAlert } from "@/lib/types";

// 전화/SMS (Phase 3의 마지막 단, 흐름도 1의 "Slack → email → 전화").
//
// 가장 시끄러운 채널이라 **에스컬레이션 통지에만** 반응한다: 최초 FIRING
// 팬아웃은 Slack/email의 몫이고, 시간이 지나 사다리가 움직일 때만 다음 순위
// 한 명에게 문자가 가고, TWILIO_VOICE=true면 전화까지 건다.
//
// Twilio SDK 대신 REST 직접 호출 — 쓰는 건 폼 POST 두 개뿐이라 의존성을
// 들일 이유가 없다.

const API = "https://api.twilio.com/2010-04-01";

function creds() {
  return {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_FROM,
    voice: process.env.TWILIO_VOICE === "true",
  };
}

async function post(
  sid: string,
  token: string,
  path: string,
  form: Record<string, string>,
) {
  const res = await fetch(`${API}/Accounts/${sid}/${path}`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    throw new Error(`Twilio ${path} returned ${res.status} ${res.statusText}`);
  }
}

/** TwiML은 XML이다 — 제목이 페이로드에서 온 외부 문자열임을 잊지 말 것. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const twilioNotifier: Notifier = {
  name: "twilio",

  isConfigured() {
    const c = creds();
    return Boolean(c.sid && c.token && c.from);
  },

  async notify(alert: NormalizedAlert, ctx: NotifyContext = {}) {
    const { sid, token, from, voice } = creds();
    if (!sid || !token || !from) return "skipped";
    // 에스컬레이션 전용: 최초 통지에는 침묵한다.
    if (!ctx.escalationStep) return "skipped";
    const target = ctx.assignees?.[0];
    if (!target?.phone) return "skipped";

    const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
    const link = appUrl && ctx.alertId ? ` ${appUrl}/alerts/${ctx.alertId}` : "";
    await post(sid, token, "Messages.json", {
      To: target.phone,
      From: from,
      Body: `[alert-hub] ${ctx.escalationStep}순위 에스컬레이션 — ${alert.title} (${alert.severity}). 앞 순위 미ack.${link}`,
    });

    if (voice) {
      const say = xmlEscape(
        `알럿 허브 자동 에스컬레이션입니다. ${alert.title} 알람이 아직 처리되지 않아 ` +
          `${ctx.escalationStep}순위 ${target.name}님께 연결되었습니다. 대시보드를 확인해 주세요.`,
      );
      await post(sid, token, "Calls.json", {
        To: target.phone,
        From: process.env.TWILIO_VOICE_FROM ?? from,
        Twiml: `<Response><Say language="ko-KR">${say}</Say></Response>`,
      });
    }
    return "sent";
  },
};
