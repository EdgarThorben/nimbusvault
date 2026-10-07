import { desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { items, shareLinks } from "../db/schema";

export async function getShareLinkByToken(token: string) {
  const [row] = await db
    .select({ link: shareLinks, item: items })
    .from(shareLinks)
    .innerJoin(items, eq(shareLinks.itemId, items.id))
    .where(eq(shareLinks.token, token))
    .limit(1);
  return row ?? null;
}

export async function listShareLinks(itemId: string) {
  return db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.itemId, itemId))
    .orderBy(desc(shareLinks.createdAt));
}
