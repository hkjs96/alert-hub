// 뮤트/점검 창 기간 프리셋 → 실제 [startsAt, endsAt) 계산. 제출 시점
// 서버에서 평가한다 — 폼이 열려 있던 시간만큼 어긋나지 않게. 순수 함수라
// silence-actions와 분리해 테스트한다.

/** datetime-local ("YYYY-MM-DDTHH:mm") — 앱 전체가 Z 기준이므로 UTC로 읽는다. */
export function parseUtcLocal(v: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) {
    throw new Error(`invalid datetime: ${v}`);
  }
  return new Date(`${v}:00Z`);
}

export function resolveWindow(
  preset: string,
  now: Date,
  custom: { startsAt?: string | null; endsAt?: string | null },
): { startsAt: Date; endsAt: Date } {
  const hour = 60 * 60 * 1000;
  switch (preset) {
    case "1h":
      return { startsAt: now, endsAt: new Date(now.getTime() + hour) };
    case "4h":
      return { startsAt: now, endsAt: new Date(now.getTime() + 4 * hour) };
    case "tomorrow9": {
      const end = new Date(now);
      end.setUTCHours(9, 0, 0, 0);
      if (end <= now) end.setUTCDate(end.getUTCDate() + 1);
      return { startsAt: now, endsAt: end };
    }
    case "today23": {
      const end = new Date(now);
      end.setUTCHours(23, 0, 0, 0);
      if (end <= now) end.setUTCDate(end.getUTCDate() + 1);
      return { startsAt: now, endsAt: end };
    }
    case "custom": {
      if (!custom.endsAt) throw new Error("기간 지정에는 종료 시각이 필요합니다");
      const startsAt = custom.startsAt ? parseUtcLocal(custom.startsAt) : now;
      const endsAt = parseUtcLocal(custom.endsAt);
      if (endsAt <= startsAt) throw new Error("종료가 시작보다 뒤여야 합니다");
      return { startsAt, endsAt };
    }
    default:
      throw new Error(`unknown preset: ${preset}`);
  }
}
