import { describe, expect, it } from "vitest";
import {
  isActive,
  matchSilence,
  muteUntilLabel,
  silenceStatus,
  type SilenceRow,
} from "@/lib/silence";
import { resolveWindow, parseUtcLocal } from "@/lib/silence-window";

// 뮤트/점검 창의 순수 코어: 매칭(스코프 상속), 상태, 기간 프리셋.

const NOW = new Date("2026-09-02T11:20:00Z");

function row(overrides: Partial<SilenceRow> = {}): SilenceRow {
  return {
    id: "s1",
    alertId: null,
    customerId: null,
    projectId: null,
    serviceId: null,
    startsAt: new Date("2026-09-02T11:00:00Z"),
    endsAt: new Date("2026-09-02T12:20:00Z"),
    reason: "정기 배포 (CHG-1)",
    createdBy: null,
    revokedAt: null,
    ...overrides,
  };
}

const SCOPE = {
  alertId: "a1",
  customerId: "cust1",
  projectId: "proj1",
  serviceId: "svc1",
};

describe("silenceStatus", () => {
  it("예약 → 진행 중 → 종료, 해제는 언제나 revoked", () => {
    const s = row();
    expect(silenceStatus(s, new Date("2026-09-02T10:59:00Z"))).toBe("scheduled");
    expect(silenceStatus(s, NOW)).toBe("active");
    expect(silenceStatus(s, new Date("2026-09-02T12:20:00Z"))).toBe("ended");
    expect(silenceStatus(row({ revokedAt: NOW }), NOW)).toBe("revoked");
    expect(isActive(row({ revokedAt: NOW }), NOW)).toBe(false);
  });
});

describe("matchSilence — 스코프와 상속", () => {
  it("알람 단위 뮤트는 그 알람만 잡는다", () => {
    const s = row({ alertId: "a1" });
    expect(matchSilence([s], SCOPE, NOW)?.id).toBe("s1");
    expect(matchSilence([s], { ...SCOPE, alertId: "a2" }, NOW)).toBeNull();
  });

  it("조직 스코프는 하위로 상속된다 — 고객사 창이 서비스 알람을 덮는다", () => {
    expect(matchSilence([row({ serviceId: "svc1" })], SCOPE, NOW)).not.toBeNull();
    expect(matchSilence([row({ projectId: "proj1" })], SCOPE, NOW)).not.toBeNull();
    expect(matchSilence([row({ customerId: "cust1" })], SCOPE, NOW)).not.toBeNull();
    expect(
      matchSilence([row({ customerId: "cust-other" })], SCOPE, NOW),
    ).toBeNull();
  });

  it("미매핑 알람(체인 없음)은 알람 단위 뮤트만 잡힌다", () => {
    const scope = { alertId: "a1" };
    expect(matchSilence([row({ customerId: "cust1" })], scope, NOW)).toBeNull();
    expect(matchSilence([row({ alertId: "a1" })], scope, NOW)).not.toBeNull();
  });

  it("예약·종료·해제된 창은 잡지 않는다", () => {
    expect(
      matchSilence(
        [row({ serviceId: "svc1", startsAt: new Date("2026-09-02T17:00:00Z"), endsAt: new Date("2026-09-02T19:00:00Z") })],
        SCOPE,
        NOW,
      ),
    ).toBeNull();
    expect(
      matchSilence([row({ serviceId: "svc1", revokedAt: NOW })], SCOPE, NOW),
    ).toBeNull();
  });

  it("여럿이 겹치면 가장 늦게 끝나는 창을 고른다 — 칩의 ~시각과 일치해야", () => {
    const shorter = row({ id: "short", serviceId: "svc1" });
    const longer = row({
      id: "long",
      customerId: "cust1",
      endsAt: new Date("2026-09-02T23:00:00Z"),
    });
    expect(matchSilence([shorter, longer], SCOPE, NOW)?.id).toBe("long");
    expect(muteUntilLabel(longer.endsAt)).toBe("~23:00Z");
  });
});

describe("resolveWindow — 기간 프리셋", () => {
  it("1h/4h는 지금부터", () => {
    const w = resolveWindow("1h", NOW, {});
    expect(w.startsAt).toEqual(NOW);
    expect(w.endsAt).toEqual(new Date("2026-09-02T12:20:00Z"));
    expect(resolveWindow("4h", NOW, {}).endsAt).toEqual(
      new Date("2026-09-02T15:20:00Z"),
    );
  });

  it("tomorrow9/today23 — 이미 지난 시각이면 다음 날로 넘긴다", () => {
    expect(resolveWindow("tomorrow9", NOW, {}).endsAt).toEqual(
      new Date("2026-09-03T09:00:00Z"),
    );
    expect(resolveWindow("today23", NOW, {}).endsAt).toEqual(
      new Date("2026-09-02T23:00:00Z"),
    );
    const late = new Date("2026-09-02T23:30:00Z");
    expect(resolveWindow("today23", late, {}).endsAt).toEqual(
      new Date("2026-09-03T23:00:00Z"),
    );
  });

  it("custom — datetime-local을 UTC로 읽고, 시작 생략 시 지금부터, 역순이면 거부", () => {
    const w = resolveWindow("custom", NOW, {
      startsAt: "2026-09-02T17:00",
      endsAt: "2026-09-02T19:00",
    });
    expect(w.startsAt).toEqual(new Date("2026-09-02T17:00:00Z"));
    expect(w.endsAt).toEqual(new Date("2026-09-02T19:00:00Z"));

    expect(resolveWindow("custom", NOW, { endsAt: "2026-09-02T12:00" }).startsAt).toEqual(NOW);
    expect(() => resolveWindow("custom", NOW, { endsAt: "2026-09-02T10:00" })).toThrow();
    expect(() => resolveWindow("custom", NOW, {})).toThrow();
    expect(() => resolveWindow("nope", NOW, {})).toThrow();
    expect(() => parseUtcLocal("2026-09-02")).toThrow();
  });
});
