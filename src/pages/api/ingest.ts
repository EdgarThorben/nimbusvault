import type { APIRoute } from "astro";
import { and, eq } from "drizzle-orm";
import { z } from "astro:schema";
import { db } from "../../db/client";
import { ingestEvents, itemTypes } from "../../db/schema";
import { verifyIngestRequest } from "../../lib/ingestAuth";

export const prerender = false;

// The mailbox. A signed payload lands in `ingest_events` with status
// "pending" and stops there — see the table comment in src/db/schema.ts for
// why nothing is written straight into `items`.

const payloadSchema = z.object({
  source: z.string().min(1).max(64),
  /** Sender's own event id, used to make retries idempotent. Optional. */
  externalId: z.string().max(128).optional(),
  item: z.object({
    name: z.string().min(1),
    type: z.enum(itemTypes),
    collectionSlug: z.string().min(1),
    section: z.string().optional(),
    region: z.string().optional(),
    fields: z
      .array(
        z.object({
          category: z.string(),
          label: z.string().min(1),
          value: z.string(),
        }),
      )
      .default([]),
  }),
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  // Read the body as text: the signature covers the exact bytes sent, so
  // parsing first and re-serializing would break every comparison.
  const rawBody = await request.text();

  const verified = verifyIngestRequest(request, rawBody);
  if (!verified.ok) {
    return json({ error: verified.reason }, verified.status);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return json({ error: "Body was not valid JSON." }, 400);
  }

  const parsed = payloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return json({ error: "Payload failed validation.", issues: parsed.error.issues }, 400);
  }

  const { source, externalId, item } = parsed.data;

  // Webhook senders retry on any non-2xx, and a duplicate delivery must not
  // create a second review task. Report the original event instead.
  if (externalId) {
    const [existing] = await db
      .select({ id: ingestEvents.id, status: ingestEvents.status })
      .from(ingestEvents)
      .where(and(eq(ingestEvents.source, source), eq(ingestEvents.externalId, externalId)))
      .limit(1);
    if (existing) {
      return json({ id: existing.id, status: existing.status, duplicate: true }, 200);
    }
  }

  const [row] = await db
    .insert(ingestEvents)
    .values({
      source,
      externalId: externalId ?? null,
      payload: {
        name: item.name,
        type: item.type,
        collectionSlug: item.collectionSlug,
        section: item.section,
        region: item.region,
        fields: item.fields,
      },
    })
    .returning({ id: ingestEvents.id });

  // 202, not 201: it's queued for review, and may never become an item.
  return json({ id: row.id, status: "pending" }, 202);
};
