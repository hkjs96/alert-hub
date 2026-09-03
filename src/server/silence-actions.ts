"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/auth";
import { resolveWindow } from "@/lib/silence-window";

// 점검 창 · 뮤트 액션. 기간 프리셋은 제출 시점 서버에서 계산한다("use server"
// 모듈은 async export만 허용되므로 계산 자체는 lib/silence-window에 있다).

function requireString(formData: FormData, key: string): string {
  const v = formData.get(key);
  if (typeof v !== "string" || !v.trim()) throw new Error(`missing ${key}`);
  return v.trim();
}

function optionalString(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function backPath(formData: FormData, fallback: string): string {
  const back = optionalString(formData, "back");
  return back && back.startsWith("/") ? back : fallback;
}

/** 등록 관리 › 점검 · 뮤트: 조직 스코프 점검 창 등록. */
export async function createSilence(formData: FormData) {
  await requireRole("OPERATOR");
  // 범위 라디오는 "level:scopeId" 한 값으로 온다 — 라디오 하나가 레벨과
  // 대상 id를 동시에 결정해야 해서다.
  const [level, scopeId] = requireString(formData, "levelScope").split(":", 2);
  if (!level || !scopeId) throw new Error("invalid levelScope");
  const reason = requireString(formData, "reason");
  const createdBy = optionalString(formData, "createdBy");
  const window = resolveWindow(requireString(formData, "preset"), new Date(), {
    startsAt: optionalString(formData, "startsAt"),
    endsAt: optionalString(formData, "endsAt"),
  });

  const scope =
    level === "customer"
      ? { customerId: scopeId }
      : level === "project"
        ? { projectId: scopeId }
        : level === "service"
          ? { serviceId: scopeId }
          : null;
  if (!scope) throw new Error(`invalid level: ${level}`);

  await prisma.silence.create({ data: { ...scope, ...window, reason, createdBy } });

  const back = backPath(formData, "/admin/silences");
  revalidatePath("/admin/silences");
  revalidatePath("/");
  redirect(back);
}

/** 알람 상세의 뮤트: 이 알람만, 또는 알람이 속한 서비스 전체. */
export async function muteAlert(formData: FormData) {
  await requireRole("OPERATOR");
  const alertId = requireString(formData, "alertId");
  const scopeKind = requireString(formData, "scope");
  const reason = requireString(formData, "reason");
  const window = resolveWindow(requireString(formData, "preset"), new Date(), {
    endsAt: optionalString(formData, "endsAt"),
  });

  let scope: { alertId: string } | { serviceId: string };
  if (scopeKind === "service") {
    const serviceId = requireString(formData, "serviceId");
    scope = { serviceId };
  } else {
    scope = { alertId };
  }

  await prisma.silence.create({ data: { ...scope, ...window, reason } });

  revalidatePath(`/alerts/${alertId}`);
  revalidatePath("/");
  revalidatePath("/admin/silences");
  redirect(backPath(formData, `/alerts/${alertId}`));
}

/** 지금 해제 / 예약 취소 — 행은 남기고 revokedAt만 찍는다 (감사 로그). */
export async function revokeSilence(formData: FormData) {
  await requireRole("OPERATOR");
  const id = requireString(formData, "id");
  await prisma.silence.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  revalidatePath("/admin/silences");
  revalidatePath("/");
  redirect(backPath(formData, "/admin/silences"));
}
