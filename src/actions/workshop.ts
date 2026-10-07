import { randomBytes, randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";
import { ActionError, defineAction } from "astro:actions";
import { z } from "astro:schema";
import { and, eq, inArray, isNull, max, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  approvalDecisions,
  approvals,
  customers,
  jobPhotos,
  jobStatuses,
  jobs,
  lineItemKinds,
  lineItems,
  vehicles,
} from "../db/schema";
import { blobToken } from "../lib/blob";
import { getLatestApproval, normalizePlate } from "../lib/jobs";
import { parsePriceToCents, parseQty } from "../lib/money";

function requireLeo(locals: App.Locals) {
  if (!locals.user) {
    throw new ActionError({ code: "UNAUTHORIZED", message: "Please log in first." });
  }
  return locals.user;
}

async function requireJob(jobId: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new ActionError({ code: "NOT_FOUND", message: "That job no longer exists." });
  return job;
}

const touch = () => ({ updatedAt: new Date() });

export const checkIn = defineAction({
  accept: "form",
  input: z.object({
    plate: z.string().trim().min(1, "Enter the number plate."),
    makeModel: z.string().trim().default(""),
    title: z.string().trim().min(1, "What needs doing?"),
    customerName: z.string().trim().default(""),
    phone: z.string().trim().default(""),
    email: z.string().trim().default(""),
  }),
  handler: async (input, context) => {
    requireLeo(context.locals);
    const plate = normalizePlate(input.plate);

    const jobId = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(vehicles).where(eq(vehicles.plate, plate)).limit(1);
      let vehicleId: string;

      if (existing) {
        vehicleId = existing.id;
        if (input.makeModel && input.makeModel !== existing.makeModel) {
          await tx.update(vehicles).set({ makeModel: input.makeModel }).where(eq(vehicles.id, existing.id));
        }
        // Only fill in contact details; never overwrite what's on file from a quick check-in.
        const [owner] = await tx.select().from(customers).where(eq(customers.id, existing.customerId));
        const patch: Partial<typeof customers.$inferInsert> = {};
        if (input.phone && !owner.phone) patch.phone = input.phone;
        if (input.email && !owner.email) patch.email = input.email;
        if (Object.keys(patch).length) {
          await tx.update(customers).set(patch).where(eq(customers.id, owner.id));
        }
      } else {
        if (!input.customerName) {
          throw new ActionError({ code: "BAD_REQUEST", message: "New car: enter the customer's name." });
        }
        const [customer] = await tx
          .insert(customers)
          .values({ name: input.customerName, phone: input.phone, email: input.email })
          .returning();
        const [vehicle] = await tx
          .insert(vehicles)
          .values({ plate, makeModel: input.makeModel, customerId: customer.id })
          .returning();
        vehicleId = vehicle.id;
      }

      const [job] = await tx.insert(jobs).values({ vehicleId, title: input.title }).returning();
      return job.id;
    });

    return { id: jobId };
  },
});

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

export const uploadPhoto = defineAction({
  accept: "form",
  input: z.object({
    jobId: z.uuid(),
    photos: z.array(z.instanceof(File)).default([]),
  }),
  handler: async ({ jobId, photos }, context) => {
    requireLeo(context.locals);
    await requireJob(jobId);
    const files = photos.filter((f) => f.size > 0);
    if (!files.length) throw new ActionError({ code: "BAD_REQUEST", message: "No photo received." });

    for (const file of files) {
      if (file.size > MAX_PHOTO_BYTES || !file.type.startsWith("image/")) {
        throw new ActionError({ code: "BAD_REQUEST", message: "Photos must be images under 4 MB." });
      }
      const ext = file.type === "image/png" ? "png" : "jpg";
      const blob = await put(`jobs/${jobId}/${randomUUID()}.${ext}`, Buffer.from(await file.arrayBuffer()), {
        access: "private",
        contentType: file.type,
        token: blobToken(),
      });
      await db.insert(jobPhotos).values({ jobId, pathname: blob.pathname });
    }
    await db.update(jobs).set(touch()).where(eq(jobs.id, jobId));
    return { jobId };
  },
});

export const deletePhoto = defineAction({
  accept: "form",
  input: z.object({ id: z.uuid() }),
  handler: async ({ id }, context) => {
    requireLeo(context.locals);
    const [photo] = await db.delete(jobPhotos).where(eq(jobPhotos.id, id)).returning();
    if (!photo) throw new ActionError({ code: "NOT_FOUND", message: "Photo not found." });
    await del(photo.pathname, { token: blobToken() }).catch(() => {});
    return { jobId: photo.jobId };
  },
});

export const saveFindings = defineAction({
  accept: "form",
  input: z.object({ jobId: z.uuid(), findings: z.string().default("") }),
  handler: async ({ jobId, findings }, context) => {
    requireLeo(context.locals);
    await requireJob(jobId);
    await db.update(jobs).set({ findings: findings.trim(), ...touch() }).where(eq(jobs.id, jobId));
    return { jobId };
  },
});

export const saveEstimate = defineAction({
  accept: "form",
  input: z.object({
    jobId: z.uuid(),
    description: z.array(z.string()).default([]),
    kind: z.array(z.enum(lineItemKinds)).default([]),
    qty: z.array(z.string()).default([]),
    unitPrice: z.array(z.string()).default([]),
  }),
  handler: async ({ jobId, description, kind, qty, unitPrice }, context) => {
    requireLeo(context.locals);
    const job = await requireJob(jobId);
    if (job.status === "invoiced") {
      throw new ActionError({ code: "BAD_REQUEST", message: "This job is already invoiced." });
    }

    const rows: (typeof lineItems.$inferInsert)[] = [];
    for (let i = 0; i < description.length; i++) {
      const desc = description[i]?.trim() ?? "";
      if (!desc && !unitPrice[i]?.trim()) continue; // blank row
      const q = parseQty(qty[i] ?? "1");
      const cents = parsePriceToCents(unitPrice[i] ?? "");
      if (!desc || q === null || cents === null) {
        throw new ActionError({
          code: "BAD_REQUEST",
          message: `Line ${i + 1}: needs a description, a quantity and a price like 49.90.`,
        });
      }
      rows.push({ jobId, description: desc, kind: kind[i] ?? "part", qty: q, unitPriceCents: cents, sortOrder: i });
    }

    await db.transaction(async (tx) => {
      await tx.delete(lineItems).where(eq(lineItems.jobId, jobId));
      if (rows.length) await tx.insert(lineItems).values(rows);
      await tx.update(jobs).set(touch()).where(eq(jobs.id, jobId));
    });
    return { jobId };
  },
});

export const setStatus = defineAction({
  accept: "form",
  input: z.object({ jobId: z.uuid(), status: z.enum(jobStatuses) }),
  handler: async ({ jobId, status }, context) => {
    requireLeo(context.locals);
    const job = await requireJob(jobId);
    if (job.invoiceNumber !== null && status !== "invoiced") {
      throw new ActionError({ code: "BAD_REQUEST", message: "An invoiced job can't be reopened." });
    }
    if (status === "invoiced" && job.invoiceNumber === null) {
      throw new ActionError({ code: "BAD_REQUEST", message: "Create the invoice from the Invoices tab." });
    }
    await db.update(jobs).set({ status, ...touch() }).where(eq(jobs.id, jobId));
    return { jobId };
  },
});

/** Issues a fresh customer link. Older links for the job stop accepting decisions. */
export const sendForApproval = defineAction({
  input: z.object({ jobId: z.uuid() }),
  handler: async ({ jobId }, context) => {
    requireLeo(context.locals);
    const job = await requireJob(jobId);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(lineItems)
      .where(eq(lineItems.jobId, jobId));
    if (!count) {
      throw new ActionError({ code: "BAD_REQUEST", message: "Add at least one estimate line first." });
    }
    if (job.invoiceNumber !== null) {
      throw new ActionError({ code: "BAD_REQUEST", message: "This job is already invoiced." });
    }

    const token = randomBytes(24).toString("base64url");
    await db.transaction(async (tx) => {
      await tx.insert(approvals).values({ jobId, token });
      if (job.status === "checked_in" || job.status === "approved") {
        await tx.update(jobs).set({ status: "awaiting_approval", ...touch() }).where(eq(jobs.id, jobId));
      }
    });
    return { token };
  },
});

/** Public: the customer's answer on /a/[token]. "Not now" can still be turned into an approval later. */
export const decideApproval = defineAction({
  accept: "form",
  input: z.object({ token: z.string().min(16), decision: z.enum(approvalDecisions) }),
  handler: async ({ token, decision }) => {
    return db.transaction(async (tx) => {
      const [approval] = await tx.select().from(approvals).where(eq(approvals.token, token)).limit(1);
      if (!approval) throw new ActionError({ code: "NOT_FOUND", message: "This link is not valid." });

      const latest = await getLatestApproval(approval.jobId);
      if (latest?.id !== approval.id) {
        throw new ActionError({
          code: "BAD_REQUEST",
          message: "This estimate has been updated. Please open the newest link from Leo.",
        });
      }

      const [updated] = await tx
        .update(approvals)
        .set({ decision, decidedAt: new Date() })
        .where(
          and(
            eq(approvals.id, approval.id),
            or(isNull(approvals.decision), eq(approvals.decision, "declined")),
          ),
        )
        .returning();
      if (!updated) {
        throw new ActionError({ code: "BAD_REQUEST", message: "You already approved this repair." });
      }

      if (decision === "approved") {
        await tx
          .update(jobs)
          .set({ status: "approved", ...touch() })
          .where(and(eq(jobs.id, approval.jobId), inArray(jobs.status, ["checked_in", "awaiting_approval"])));
      }
      return { decision };
    });
  },
});

export const createInvoice = defineAction({
  accept: "form",
  input: z.object({ jobId: z.uuid() }),
  handler: async ({ jobId }, context) => {
    requireLeo(context.locals);
    const job = await requireJob(jobId);
    if (job.invoiceNumber !== null) return { jobId };
    if (!["approved", "in_progress", "ready"].includes(job.status)) {
      throw new ActionError({ code: "BAD_REQUEST", message: "Only approved jobs can be invoiced." });
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(lineItems)
      .where(eq(lineItems.jobId, jobId));
    if (!count) throw new ActionError({ code: "BAD_REQUEST", message: "This job has no line items." });

    // Single user, so a max+1 sequence is enough; the unique index catches any collision.
    const [{ last }] = await db.select({ last: max(jobs.invoiceNumber) }).from(jobs);
    await db
      .update(jobs)
      .set({ invoiceNumber: (last ?? 0) + 1, invoicedAt: new Date(), status: "invoiced", ...touch() })
      .where(and(eq(jobs.id, jobId), isNull(jobs.invoiceNumber)));
    return { jobId };
  },
});
