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
  revalidatePath(backPath(formData, "/admin/customers"));
}

export async function deleteProject(formData: FormData) {
  await prisma.project.delete({ where: { id: requireString(formData, "id") } });
  revalidatePath(backPath(formData, "/admin/customers"));
}

// --- Services ------------------------------------------------------------------

export async function createService(formData: FormData) {
  await prisma.service.create({
    data: {
      name: requireString(formData, "name"),
      projectId: requireString(formData, "projectId"),
    },
  });
  revalidatePath(backPath(formData, "/admin/customers"));
}

export async function deleteService(formData: FormData) {
  await prisma.service.delete({ where: { id: requireString(formData, "id") } });
  revalidatePath(backPath(formData, "/admin/customers"));
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
  revalidatePath(backPath(formData, "/admin/customers"));
}

export async function deleteAccountMap(formData: FormData) {
  await prisma.awsAccountMap.delete({
    where: { id: requireString(formData, "id") },
  });
  revalidatePath(backPath(formData, "/admin/customers"));
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

// --- Assignments (붙였다뗐다) ------------------------------------------------------

const SCOPE_FIELD: Record<ScopeLevel, "customerId" | "projectId" | "serviceId" | "accountId"> = {
  customer: "customerId",
  project: "projectId",
  service: "serviceId",
  account: "accountId",
};

/**
 * Attach a contact to a scope. OWNER uses replace semantics (a scope keeps at
 * most one OWNER); DEPUTY/MEMBER just add rows. Duplicate person+kind on the
 * same scope is a no-op.
 */
export async function addAssignment(formData: FormData) {
  const level = requireString(formData, "level") as ScopeLevel;
  const scopeId = requireString(formData, "scopeId");
  const contactId = requireString(formData, "contactId");
  const kind = requireString(formData, "kind");
  const field = SCOPE_FIELD[level];
  if (!field) throw new Error(`bad scope level: ${level}`);

  if (kind === "OWNER") {
    await prisma.assignment.deleteMany({
      where: { [field]: scopeId, kind: "OWNER" },
    });
  } else {
    const dup = await prisma.assignment.findMany({
      where: { [field]: scopeId, kind, contactId },
    });
    if (dup.length) {
      revalidatePath(backPath(formData, "/admin/customers"));
      return;
    }
  }

  await prisma.assignment.create({
    data: { kind, contactId, [field]: scopeId },
  });
  revalidatePath(backPath(formData, "/admin/customers"));
}

export async function removeAssignment(formData: FormData) {
  await prisma.assignment.delete({
    where: { id: requireString(formData, "id") },
  });
  revalidatePath(backPath(formData, "/admin/customers"));
}
