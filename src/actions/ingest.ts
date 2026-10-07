import { ActionError, defineAction } from "astro:actions";
import { z } from "astro:schema";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { collections, ingestEvents, itemRelationships, itemRevisions, items } from "../db/schema";
import type { SessionUser } from "../lib/auth";
import { JOB_LABELS } from "../lib/jobCapture";
import { diffDetails } from "../lib/diff";
import { getItemBySlug } from "../lib/itemQueries";
import { slugify } from "../lib/slug";

function requireUser(locals: App.Locals): SessionUser {
  if (!locals.user) {
    throw new ActionError({ code: "UNAUTHORIZED", message: "You must be logged in to do that." });
  }
  return locals.user;
}

async function loadPendingEvent(id: string) {
  const [event] = await db.select().from(ingestEvents).where(eq(ingestEvents.id, id)).limit(1);
  if (!event) {
    throw new ActionError({ code: "NOT_FOUND", message: "That ingest event no longer exists." });
  }
  if (event.status !== "pending") {
    throw new ActionError({
      code: "BAD_REQUEST",
      message: "That event has already been reviewed.",
    });
  }
  return event;
}

/**
 * Promotes a staged webhook event into the documentation. An event whose
 * payload resolves to an existing slug updates that item; otherwise a new one
 * is created. Either way it goes through the normal revision machinery, so an
 * automated update is as auditable as a hand-typed one — the revision names
 * the source that sent it.
 */
export const applyIngestEvent = defineAction({
  accept: "form",
  input: z.object({ id: z.string().uuid() }),
  handler: async ({ id }, context) => {
    const user = requireUser(context.locals);
    const event = await loadPendingEvent(id);
    const payload = event.payload;

    const [collection] = await db
      .select()
      .from(collections)
      .where(eq(collections.slug, payload.collectionSlug))
      .limit(1);
    if (!collection) {
      throw new ActionError({
        code: "BAD_REQUEST",
        message: `No collection with the slug "${payload.collectionSlug}". Create it first, then apply this event.`,
      });
    }

    // Jobs always create a new item (never overwrite one with the same name),
    // attached to a vehicle found or created by plate.
    const isJob = payload.type === "job";
    const slug = isJob ? `${slugify(payload.name)}-${event.id.slice(0, 6)}` : slugify(payload.name);
    const existing = isJob ? null : await getItemBySlug(slug);
    let itemId: string;

    if (existing) {
      const changes = diffDetails(existing.fields, payload.fields);
      const nextRevision = existing.currentRevision + 1;
      await db
        .update(items)
        .set({
          name: payload.name,
          region: payload.region?.trim() || existing.region,
          section: payload.section?.trim() || existing.section,
          fields: payload.fields,
          updatedBy: user.id,
          updatedAt: new Date(),
          currentRevision: nextRevision,
        })
        .where(eq(items.id, existing.id));

      await db.insert(itemRevisions).values({
        itemId: existing.id,
        revisionNo: nextRevision,
        authorId: user.id,
        summary: `Applied ingest event from "${event.source}".`,
        fieldsSnapshot: payload.fields,
        changes,
      });
      itemId = existing.id;
    } else {
      const [created] = await db
        .insert(items)
        .values({
          type: payload.type,
          collectionId: collection.id,
          section: payload.section?.trim() || null,
          slug,
          name: payload.name,
          region: payload.region?.trim() || null,
          fields: payload.fields,
          photos: payload.photos ?? [],
          createdBy: user.id,
          updatedBy: user.id,
          currentRevision: 1,
        })
        .returning();

      await db.insert(itemRevisions).values({
        itemId: created.id,
        revisionNo: 1,
        authorId: user.id,
        summary: `Created from ingest event sent by "${event.source}".`,
        fieldsSnapshot: payload.fields,
        changes: [],
      });
      itemId = created.id;

      const plate = payload.fields.find((f) => f.label === JOB_LABELS.plate)?.value.trim();
      if (isJob && plate) {
        const vehicleSlug = `fahrzeug-${slugify(plate)}`;
        let vehicle = await getItemBySlug(vehicleSlug);
        if (!vehicle) {
          const vehicleFields = payload.fields.filter((f) => f.category === "Fahrzeug");
          const [createdVehicle] = await db
            .insert(items)
            .values({
              type: "vehicle",
              collectionId: collection.id,
              slug: vehicleSlug,
              name: plate,
              fields: vehicleFields,
              createdBy: user.id,
              updatedBy: user.id,
              currentRevision: 1,
            })
            .returning();
          await db.insert(itemRevisions).values({
            itemId: createdVehicle.id,
            revisionNo: 1,
            authorId: user.id,
            summary: `Created from ingest event sent by "${event.source}".`,
            fieldsSnapshot: vehicleFields,
            changes: [],
          });
          vehicle = { ...createdVehicle, collectionTitle: "", collectionSlug: "", createdByName: "", updatedByName: "" };
        }
        await db.insert(itemRelationships).values({
          itemId: created.id,
          relatedItemId: vehicle.id,
          relationshipType: "attached_to",
          createdBy: user.id,
        });
      }
    }

    await db
      .update(ingestEvents)
      .set({ status: "applied", itemId, reviewedBy: user.id, reviewedAt: new Date() })
      .where(eq(ingestEvents.id, event.id));

    return { slug };
  },
});

/**
 * Dismisses a staged event. The row is kept, not deleted — "we saw this and
 * chose not to record it" is itself worth being able to look up later.
 */
export const rejectIngestEvent = defineAction({
  accept: "form",
  input: z.object({ id: z.string().uuid(), note: z.string().optional() }),
  handler: async ({ id, note }, context) => {
    const user = requireUser(context.locals);
    const event = await loadPendingEvent(id);

    await db
      .update(ingestEvents)
      .set({
        status: "rejected",
        note: note?.trim() || null,
        reviewedBy: user.id,
        reviewedAt: new Date(),
      })
      .where(eq(ingestEvents.id, event.id));

    return { id: event.id };
  },
});
