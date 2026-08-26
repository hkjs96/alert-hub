"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { ScopeLevel } from "@/lib/org/resolve";

// Mutations behind the admin UI. Plain server actions driven by <form> posts —
// no client JS needed. Each action revalidates the page it was fired from
// (the form carries the current path in a hidden `back` field).

function backPath(formData: FormData, fallback: string): string {
  const raw = formData.get("back");
  return typeof raw === "string" && raw.startsWith("/") ? raw : fallback;
}

/**
 * revalidatePath ignores a path that carries a query string, which silently
 * leaves the router cache stale — the escalation page's `back` includes its
 * scope selection as a query, so strip it before revalidating.
 */
function revalidateBack(formData: FormData, fallback: string) {
  const back = backPath(formData, fallback);
  const q = back.indexOf("?");
  revalidatePath(q === -1 ? back : back.slice(0, q));
}

function requireString(formData: FormData, key: string): string {
  const v = formData.get(key);
  if (typeof v !== "string" || !v.trim()) throw new Error(`missing ${key}`);
  return v.trim();
}

function optionalString(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// --- Customers ---------------------------------------------------------------

export async function createCustomer(formData: FormData) {
  await prisma.customer.create({
    data: {
      name: requireString(formData, "name"),
      isInternal: formData.get("isInternal") === "on",
    },
  });
  revalidatePath("/admin/customers");
}

export async function deleteCustomer(formData: FormData) {
  await prisma.customer.delete({ where: { id: requireString(formData, "id") } });
  revalidatePath("/admin/customers");
}

// --- Projects ------------------------------------------------------------------

export async function createProject(formData: FormData) {
  await prisma.project.create({
    data: {
      name: requireString(formData, "name"),
      customerId: requireString(formData, "customerId"),
    },
  });
  revalidateBack(formData, "/admin/customers");
}

export async function deleteProject(formData: FormData) {
  await prisma.project.delete({ where: { id: requireString(formData, "id") } });
  revalidateBack(formData, "/admin/customers");
}

// --- Services ------------------------------------------------------------------

export async function createService(formData: FormData) {
  await prisma.service.create({
    data: {
      name: requireString(formData, "name"),
      projectId: requireString(formData, "projectId"),
    },
  });
  revalidateBack(formData, "/admin/customers");
}

export async function deleteService(formData: FormData) {
  await prisma.service.delete({ where: { id: requireString(formData, "id") } });
  revalidateBack(formData, "/admin/customers");
}

// --- AWS account mappings --------------------------------------------------------

export async function createAccountMap(formData: FormData) {
  const accountId = requireString(formData, "accountId");
  if (!/^\d{12}$/.test(accountId)) {
    throw new Error("AWS account id must be 12 digits");
  }
  await prisma.awsAccountMap.create({
    data: {
      accountId,
      alias: optionalString(formData, "alias"),
      environment: optionalString(formData, "environment"),
      serviceId: requireString(formData, "serviceId"),
    },
  });
  revalidateBack(formData, "/admin/customers");
}

export async function deleteAccountMap(formData: FormData) {
  await prisma.awsAccountMap.delete({
    where: { id: requireString(formData, "id") },
  });
  revalidateBack(formData, "/admin/customers");
}

// --- Contacts ------------------------------------------------------------------

export async function createContact(formData: FormData) {
  await prisma.contact.create({
    data: {
      name: requireString(formData, "name"),
      email: optionalString(formData, "email"),
      phone: optionalString(formData, "phone"),
      slackId: optionalString(formData, "slackId"),
      department: optionalString(formData, "department"),
      customerId: optionalString(formData, "customerId"),
    },
  });
  revalidatePath("/admin/contacts");
}

export async function deleteContact(formData: FormData) {
  await prisma.contact.delete({ where: { id: requireString(formData, "id") } });
  revalidatePath("/admin/contacts");
}

// --- Assignments (등록: 붙였다뗐다) -------------------------------------------
//
// A scope holds an ordered list with no role labels. Registering appends to the
// end; the 알람 처리 순서 screen is what moves people around. Both screens write
// the same rows — they just expose different decisions.

const SCOPE_FIELD: Record<ScopeLevel, "customerId" | "projectId" | "serviceId" | "accountId"> = {
  customer: "customerId",
  project: "projectId",
  service: "serviceId",
  account: "accountId",
};

function scopeField(level: ScopeLevel) {
  const field = SCOPE_FIELD[level];
  if (!field) throw new Error(`bad scope level: ${level}`);
  return field;
}

/** Rewrite a scope's rows to 0..n-1 so gaps never accumulate. */
async function renumber(
  field: "customerId" | "projectId" | "serviceId" | "accountId",
  scopeId: string,
) {
  const rows = await prisma.assignment.findMany({
    where: { [field]: scopeId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  await prisma.$transaction(
    rows.map((r: { id: string }, i: number) =>
      prisma.assignment.update({ where: { id: r.id }, data: { order: i } }),
    ),
  );
}

/**
 * Attach a contact to a scope at the end of its list. Re-adding someone who is
 * already on the scope is a no-op rather than a duplicate row — a person can
 * only hold one position in one list.
 */
export async function addAssignment(formData: FormData) {
  const level = requireString(formData, "level") as ScopeLevel;
  const scopeId = requireString(formData, "scopeId");
  const contactId = requireString(formData, "contactId");
  const field = scopeField(level);

  const existing = await prisma.assignment.findFirst({
    where: { [field]: scopeId, contactId },
  });
  if (!existing) {
    const last = await prisma.assignment.findFirst({
      where: { [field]: scopeId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    try {
      await prisma.assignment.create({
        data: {
          contactId,
          [field]: scopeId,
          order: last ? last.order + 1 : 0,
        },
      });
    } catch (e) {
      // Unique(contactId, scope) race — someone attached the same person
      // between our check and the insert. Already there, so nothing to do.
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  revalidateBack(formData, "/admin/customers");
}

export async function removeAssignment(formData: FormData) {
  let row;
  try {
    row = await prisma.assignment.delete({
      where: { id: requireString(formData, "id") },
    });
  } catch (e) {
    // P2025: already gone (double submit or a concurrent remove) — the desired
    // end state is reached, so just refresh the page.
    if ((e as { code?: string }).code !== "P2025") throw e;
    revalidateBack(formData, "/admin/customers");
    return;
  }
  const field = row.customerId
    ? "customerId"
    : row.projectId
      ? "projectId"
      : row.serviceId
        ? "serviceId"
        : "accountId";
  const scopeId = row[field];
  if (scopeId) await renumber(field, scopeId);
  revalidateBack(formData, "/admin/customers");
}

/**
 * Move one person up or down within their scope's list by swapping with the
 * neighbour. Bounds are a no-op so a double-submit at the edge is harmless.
 */
export async function moveAssignment(formData: FormData) {
  const id = requireString(formData, "id");
  const direction = requireString(formData, "direction");
  if (direction !== "up" && direction !== "down") {
    throw new Error(`bad direction: ${direction}`);
  }

  const row = await prisma.assignment.findUnique({ where: { id } });
  if (!row) {
    // Removed concurrently — nothing to move.
    revalidateBack(formData, "/admin/escalation");
    return;
  }

  const field = row.customerId
    ? "customerId"
    : row.projectId
      ? "projectId"
      : row.serviceId
        ? "serviceId"
        : "accountId";
  const scopeId = row[field];
  if (!scopeId) throw new Error("assignment has no scope");

  const siblings = await prisma.assignment.findMany({
    where: { [field]: scopeId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const index = siblings.findIndex((s: { id: string }) => s.id === id);
  const target = direction === "up" ? index - 1 : index + 1;

  if (index >= 0 && target >= 0 && target < siblings.length) {
    const reordered = [...siblings];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    await prisma.$transaction(
      reordered.map((r, i) =>
        prisma.assignment.update({ where: { id: r.id }, data: { order: i } }),
      ),
    );
  }
  revalidateBack(formData, "/admin/escalation");
}
