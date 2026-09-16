import { ActionError, defineAction } from "astro:actions";
import { z } from "astro:schema";
import { itemTypes, type PageDetail } from "../db/schema";
import { listItems } from "../lib/itemQueries";
import { shortlistDuplicateCandidates, suggestNormalizations } from "../lib/fieldNormalizer";

const fieldRowSchema = z.object({
  category: z.string(),
  label: z.string(),
  value: z.string(),
});

/**
 * Advisory-only: returns suggested label/category renames and possible
 * duplicate items for a draft the author hasn't saved yet. Called from the
 * item create/edit forms, never from the save path — a slow or failing
 * suggestion request must not be able to block a write.
 */
export const suggestNormalization = defineAction({
  input: z.object({
    type: z.enum(itemTypes),
    name: z.string().default(""),
    fields: z.array(fieldRowSchema).default([]),
    /** The item being edited, so it isn't offered as its own duplicate. */
    excludeSlug: z.string().optional(),
  }),
  handler: async ({ type, name, fields, excludeSlug }, context) => {
    if (!context.locals.user) {
      throw new ActionError({ code: "UNAUTHORIZED", message: "You must be logged in to do that." });
    }

    const all = await listItems();
    const duplicateCandidates = shortlistDuplicateCandidates(
      name,
      type,
      all.filter((i) => i.status === "active" && i.slug !== excludeSlug),
    );

    return suggestNormalizations({
      type,
      name,
      fields: fields as PageDetail[],
      duplicateCandidates,
    });
  },
});
