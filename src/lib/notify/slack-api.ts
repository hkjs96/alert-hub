// Slack Web API(봇 토큰) 얇은 래퍼. 토큰이 없으면 전부 "skipped"/null — 웹훅만
// 있는 배포도 그대로 동작한다. fetch 는 주입 가능(테스트).

// 테스트에서만 바꾼다(모의 서버). 운영에서는 두지 않는다.
const API = process.env.SLACK_API_BASE?.replace(/\/+$/, "") || "https://slack.com/api";

export function botToken(): string | null {
  const t = process.env.SLACK_BOT_TOKEN?.trim();
  return t ? t : null;
}

export function isBotConfigured(): boolean {
  return Boolean(botToken());
}

/** 전사 기본 채널(봇용). 스코프에 채널이 없을 때의 폴백. */
export function defaultBotChannel(): string | null {
  const c = process.env.SLACK_DEFAULT_CHANNEL?.trim();
  return c ? c : null;
}

async function call<T extends { ok: boolean; error?: string }>(
  method: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const token = botToken();
  if (!token) throw new Error("SLACK_BOT_TOKEN 미설정");
  const res = await fetchImpl(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T;
  if (!json.ok) throw new Error(`slack ${method}: ${json.error ?? res.status}`);
  return json;
}

/** 채널(ID 또는 #이름)에 텍스트. chat:write (+ 공개 채널 미초대 시 chat:write.public). */
export async function postMessage(channel: string, text: string, fetchImpl?: typeof fetch): Promise<void> {
  await call("chat.postMessage", { channel, text, unfurl_links: false }, fetchImpl);
}

/** 사용자에게 DM. im:write. */
export async function postDm(userId: string, text: string, fetchImpl?: typeof fetch): Promise<void> {
  const opened = await call<{ ok: boolean; error?: string; channel: { id: string } }>(
    "conversations.open",
    { users: userId },
    fetchImpl,
  );
  await call("chat.postMessage", { channel: opened.channel.id, text, unfurl_links: false }, fetchImpl);
}

/** 이메일 → Slack 사용자 ID. users:read.email. 없거나 권한 없으면 null. */
export async function lookupUserByEmail(email: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const token = botToken();
  if (!token) return null;
  try {
    const res = await fetchImpl(`${API}/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as { ok: boolean; user?: { id: string } };
    return json.ok && json.user ? json.user.id : null;
  } catch {
    return null;
  }
}

/** 토큰 자체 점검(진단 화면). auth.test → 워크스페이스·봇 이름. */
export async function authTest(fetchImpl?: typeof fetch): Promise<{ team: string; user: string } | null> {
  if (!botToken()) return null;
  try {
    const r = await call<{ ok: boolean; team: string; user: string }>("auth.test", {}, fetchImpl);
    return { team: r.team, user: r.user };
  } catch {
    return null;
  }
}
