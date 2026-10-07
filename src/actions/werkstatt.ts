import { randomBytes, randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { ActionError, defineAction } from "astro:actions";
import { z } from "astro:schema";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { collections, ingestEvents, itemRevisions, items, shareLinks, type IngestPayload } from "../db/schema";
import { buildJobFields, extractJob } from "../lib/jobCapture";

const MAX_PHOTOS = 6;

export const captureJob = defineAction({
  accept: "form",
  input: z.object({
    collection: z.string().min(1),
    notes: z.string().default(""),
    photos: z.array(z.instanceof(File)).default([]),
  }),
  handler: async ({ collection: collectionSlug, notes, photos }, context) => {
    const user = context.locals.user;
    if (!user) {
      throw new ActionError({ code: "UNAUTHORIZED", message: "Bitte zuerst anmelden." });
    }

    const [collection] = await db
      .select()
      .from(collections)
      .where(eq(collections.slug, collectionSlug))
      .limit(1);
    if (!collection) {
      throw new ActionError({ code: "BAD_REQUEST", message: "Kunde nicht gefunden." });
    }

    const files = photos.filter((f) => f.size > 0).slice(0, MAX_PHOTOS);
    const buffers = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));

    const token = import.meta.env?.BLOB_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN;
    const paths: string[] = [];
    for (const buf of buffers) {
      const blob = await put(`jobs/${randomUUID()}.jpg`, buf, {
        access: "private",
        contentType: "image/jpeg",
        token,
      });
      paths.push(blob.pathname);
    }

    const trimmedNotes = notes.trim();
    const job = await extractJob(
      trimmedNotes,
      buffers.map((b) => ({ data: b.toString("base64") })),
    );

    const date = new Date().toISOString().slice(0, 10);
    const payload: IngestPayload = {
      name: `Auftrag ${job.plate || "ohne Kennzeichen"} ${date}`,
      type: "job",
      collectionSlug: collection.slug,
      fields: buildJobFields(job, trimmedNotes),
      photos: paths,
    };

    await db.insert(ingestEvents).values({
      source: "capture",
      externalId: randomUUID(),
      payload,
    });

    return { ok: true };
  },
});

export const createShareLink = defineAction({
  input: z.object({ slug: z.string() }),
  handler: async ({ slug }, context) => {
    const user = context.locals.user;
    if (!user) {
      throw new ActionError({ code: "UNAUTHORIZED", message: "Bitte zuerst anmelden." });
    }
    const [item] = await db.select().from(items).where(eq(items.slug, slug)).limit(1);
    if (!item) {
      throw new ActionError({ code: "NOT_FOUND", message: "Auftrag nicht gefunden." });
    }
    const token = randomBytes(24).toString("base64url");
    await db.insert(shareLinks).values({ token, itemId: item.id, createdBy: user.id });
    return { token };
  },
});

/** Public: the customer's answer. First decision wins; the link can't be flipped afterwards. */
export const decideShareLink = defineAction({
  accept: "form",
  input: z.object({
    token: z.string().min(1),
    decision: z.enum(["approved", "declined"]),
  }),
  handler: async ({ token, decision }) => {
    await db.transaction(async (tx) => {
      const [link] = await tx
        .update(shareLinks)
        .set({ status: decision, decidedAt: new Date() })
        .where(and(eq(shareLinks.token, token), eq(shareLinks.status, "pending")))
        .returning();
      if (!link) {
        throw new ActionError({
          code: "BAD_REQUEST",
          message: "Dieser Link wurde bereits beantwortet oder ist ungültig.",
        });
      }

      const [item] = await tx.select().from(items).where(eq(items.id, link.itemId)).limit(1);
      const nextRevision = item.currentRevision + 1;
      const label = decision === "approved" ? "freigegeben" : "abgelehnt";
      await tx.update(items).set({ currentRevision: nextRevision, updatedAt: new Date() }).where(eq(items.id, item.id));
      await tx.insert(itemRevisions).values({
        itemId: item.id,
        revisionNo: nextRevision,
        authorId: null,
        summary: `Kunde hat den Kostenvoranschlag ${label} (Freigabe-Link).`,
        fieldsSnapshot: item.fields,
        changes: [{ field: "Freigabe", from: "ausstehend", to: label }],
      });
    });
    return { decision };
  },
});
