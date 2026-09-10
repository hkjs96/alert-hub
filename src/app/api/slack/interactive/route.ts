import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { atLeast } from "@/lib/auth/roles";
import { parseInteractionBody, verifySlackSignature } from "@/lib/slack/verify";
import { ACTION_KIND, buildAlertBlocks, isActionId } from "@/lib/notify/slack-blocks";
import { respondToInteraction, userDisplayName } from "@/lib/notify/slack-api";
import { transitionAlert } from "@/server/alert-transitions";
import { postThreadNote, syncSlackMessages, type ThreadNote } from "@/server/slack-sync";
import { isResolutionKind, KIND_LABELS } from "@/lib/history";
import { setResolutionKind } from "@/server/history";
import { scopeForContact } from "@/server/scope";
import { canSeeCustomer } from "@/lib/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Slack 인터랙션 (Block Kit 버튼). Slack 앱의 Interactivity Request URL 이
// 여기를 가리킨다. 서명(SLACK_SIGNING_SECRET)으로 지키므로 세션은 보지 않는다.
//
// 누른 사람은 Slack ID 로 alert-hub 인원과 매칭한다 — 매칭되는 활성 인원이
// 없거나 조회 전용이면 본인에게만 보이는 안내를 돌려주고 아무것도 바꾸지 않는다.
// 전이 자체는 알람 상세 버튼과 같은 경로(transitionAlert)를 지난다.

function ephemeral(text: string) {
  return { response_type: "ephemeral", replace_original: false, text };
}

export async function POST(req: Request) {
  const secret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "SLACK_SIGNING_SECRET 미설정" }, { status: 503 });
  }
  const body = await req.text();
  const ok = verifySlackSignature(
    secret,
    req.headers.get("x-slack-request-timestamp"),
    body,
    req.headers.get("x-slack-signature"),
  );
  if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  const payload = parseInteractionBody(body);
  if (!payload) return new NextResponse(null, { status: 200 }); // 다른 종류의 페이로드는 무시

  const action = payload.actions.find((a) => isActionId(a.action_id));
  if (!action || !isActionId(action.action_id) || !action.value) {
    return new NextResponse(null, { status: 200 });
  }
  const responseUrl = payload.response_url;
  const reply = async (b: Record<string, unknown>) => {
    if (!responseUrl) return;
    try {
      await respondToInteraction(responseUrl, b);
    } catch (err) {
      console.error("[slack:interactive] response_url failed", err);
    }
  };

  // 누가 눌렀나
  const contact = await prisma.contact.findFirst({
    where: { slackId: payload.user.id, active: true, status: "ACTIVE" },
    select: { id: true, name: true, role: true, seeAll: true, customerId: true },
  });
  if (!contact) {
    await reply(
      ephemeral(
        "alert-hub 에 연결된 Slack 계정이 아닙니다. 로그인해서 내 프로필에서 Slack 을 연결하거나 관리자에게 등록을 요청하세요.",
      ),
    );
    return new NextResponse(null, { status: 200 });
  }
  if (contact.customerId || !atLeast(contact.role, "OPERATOR")) {
    await reply(ephemeral(`${contact.name} 님은 조회 권한이라 알람을 처리할 수 없습니다.`));
    return new NextResponse(null, { status: 200 });
  }

  // 해결 분류 한 번 클릭 — 알람 전이가 아니라 기록 갱신.
  if (action.action_id.startsWith(`${ACTION_KIND}:`)) {
    const [resolutionId, kind] = action.value.split(":", 2);
    if (!resolutionId || !isResolutionKind(kind)) return new NextResponse(null, { status: 200 });
    const by = contact.name || payload.user.name || null;
    const ok = await setResolutionKind({ id: resolutionId, kind, by });
    await reply(
      ok
        ? { replace_original: true, text: `✓ ${KIND_LABELS[kind]} 으로 기록 · ${by ?? ""}`.trim() }
        : ephemeral("기록에 실패했습니다. 잠시 후 다시 눌러 주세요."),
    );
    return new NextResponse(null, { status: 200 });
  }

  const alertId = action.value;
  const alert = await prisma.alert.findUnique({ where: { id: alertId }, select: { id: true, status: true, customerId: true } });
  if (!alert) {
    await reply(ephemeral("이 알람은 더 이상 존재하지 않습니다."));
    return new NextResponse(null, { status: 200 });
  }
  if (!canSeeCustomer(await scopeForContact(contact), alert.customerId)) {
    await reply(ephemeral(`${contact.name} 님의 담당 고객사 밖 알람입니다. 담당자가 처리해야 합니다.`));
    return new NextResponse(null, { status: 200 });
  }
  const actor = contact.name || (await userDisplayName(payload.user.id)) || payload.user.name || null;
  const here =
    payload.container?.channel_id && payload.container?.message_ts
      ? { channel: payload.container.channel_id, ts: payload.container.message_ts }
      : undefined;
  const originalText = payload.message?.text ?? "";
  const appUrl = process.env.APP_URL ?? null;
  const stamp = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

  if (action.action_id === "ah_mute") {
    if (alert.status === "RESOLVED") {
      await reply(ephemeral("이미 해결된 알람입니다."));
      return new NextResponse(null, { status: 200 });
    }
    const now = new Date();
    await prisma.silence.create({
      data: {
        alertId,
        startsAt: now,
        endsAt: new Date(now.getTime() + 60 * 60 * 1000),
        reason: `Slack 뮤트 (1시간) · ${actor ?? payload.user.id}`,
        createdBy: actor,
      },
    });
    await prisma.alertEvent.create({
      data: { alertId, status: alert.status, stateReason: `1시간 뮤트 (Slack) · ${actor ?? payload.user.id}` },
    });
    const muted = `1시간 뮤트 · ${actor ?? ""} · ${stamp}`.replace(/ ·  · /, " · ");
    await reply({
      replace_original: true,
      text: originalText,
      blocks: buildAlertBlocks(originalText, { alertId, status: alert.status as "FIRING" | "ACKNOWLEDGED", muted, appUrl }),
    });
    await syncSlackMessages(alertId, { status: alert.status as "FIRING" | "ACKNOWLEDGED", muted }, { status: "MUTED", actor, via: "Slack" }, here);
    if (here) await threadHere(here, { status: "MUTED", actor, via: "Slack" });
    return new NextResponse(null, { status: 200 });
  }

  const to = action.action_id === "ah_ack" ? "ACKNOWLEDGED" : "RESOLVED";
  const from = to === "ACKNOWLEDGED" ? ["FIRING"] : ["FIRING", "ACKNOWLEDGED"];
  if (!from.includes(alert.status)) {
    await reply(
      ephemeral(
        alert.status === "RESOLVED"
          ? "이미 해결된 알람입니다."
          : `이미 ${alert.status === "ACKNOWLEDGED" ? "확인된" : alert.status} 알람입니다.`,
      ),
    );
    return new NextResponse(null, { status: 200 });
  }

  // 누른 메시지는 response_url 로 즉시 교체 (3초 안에 반응해야 한다), 나머지
  // 메시지·스레드는 transitionAlert 의 동기화가 맡는다.
  await reply({
    replace_original: true,
    text: originalText,
    blocks: buildAlertBlocks(originalText, {
      alertId,
      status: to,
      note: `${actor ?? payload.user.id} · Slack · ${stamp}`,
      appUrl,
    }),
  });
  const result = await transitionAlert({
    id: alertId,
    from,
    to,
    reason: to === "ACKNOWLEDGED" ? "Ack (Slack 버튼)" : "Resolve (Slack 버튼)",
    actor,
    via: "Slack",
    skipSlackMessage: here,
  });
  if (!result.moved) {
    await reply(ephemeral("그 사이 상태가 바뀌어 처리하지 않았습니다."));
  } else if (here) {
    // 누른 메시지의 스레드는 동기화가 건너뛰었으니 여기서 한 줄 (+해결이면 분류 버튼).
    await threadHere(here, { status: to, actor, via: "Slack", resolutionId: result.resolutionId });
  }
  return new NextResponse(null, { status: 200 });
}

async function threadHere(ref: { channel: string; ts: string }, note: ThreadNote) {
  try {
    await postThreadNote(ref, note);
  } catch (err) {
    console.error("[slack:interactive] thread reply failed", err);
  }
}
