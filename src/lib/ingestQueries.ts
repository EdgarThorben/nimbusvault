import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { ingestEvents, items, users } from "../db/schema";

/** Badge count for the nav — kept to a single aggregate, it runs per request. */
export async function countPendingIngestEvents(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ingestEvents)
    .where(eq(ingestEvents.status, "pending"));
  return row?.count ?? 0;
}

/**
 * The review queue. Pending events first regardless of age — they're the ones
 * that need a decision — then everything already reviewed, newest first.
 */
export async function listIngestEvents(limit = 50) {
  return db
    .select({
      id: ingestEvents.id,
      source: ingestEvents.source,
      externalId: ingestEvents.externalId,
      payload: ingestEvents.payload,
      status: ingestEvents.status,
      note: ingestEvents.note,
      receivedAt: ingestEvents.receivedAt,
      reviewedAt: ingestEvents.reviewedAt,
      reviewerName: users.displayName,
      itemSlug: items.slug,
      itemName: items.name,
    })
    .from(ingestEvents)
    .leftJoin(users, eq(ingestEvents.reviewedBy, users.id))
    .leftJoin(items, eq(ingestEvents.itemId, items.id))
    .orderBy(sql`case when ${ingestEvents.status} = 'pending' then 0 else 1 end`, desc(ingestEvents.receivedAt))
    .limit(limit);
}
