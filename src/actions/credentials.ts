import { ActionError, defineAction } from "astro:actions";
import { z } from "astro:schema";
import { db } from "../db/client";
import { credentialReveals, credentials } from "../db/schema";
import type { SessionUser } from "../lib/auth";
import { getItemBySlug } from "../lib/itemQueries";
import { getCredentialById } from "../lib/credentialQueries";
import { decryptSecret, encryptSecret } from "../lib/credentialCrypto";

function requireUser(locals: App.Locals): SessionUser {
  if (!locals.user) {
    throw new ActionError({ code: "UNAUTHORIZED", message: "You must be logged in to do that." });
  }
  return locals.user;
}

export const createCredential = defineAction({
  accept: "form",
  input: z.object({
    itemSlug: z.string().min(1),
    label: z.string().min(1),
    username: z.string().min(1),
    secret: z.string().min(1),
  }),
  handler: async ({ itemSlug, label, username, secret }, context) => {
    const user = requireUser(context.locals);
    const item = await getItemBySlug(itemSlug);
    if (!item) {
      throw new ActionError({ code: "NOT_FOUND", message: "Item not found." });
    }

    const encrypted = encryptSecret(secret);
    await db.insert(credentials).values({
      itemId: item.id,
      label,
      username,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      createdBy: user.id,
    });

    return { itemSlug };
  },
});

// Reveal is intentionally not gated behind per-credential permissions — any
// logged-in user may reveal, but every reveal is written to
// `credential_reveals` for audit purposes. See CLAUDE.md's confirmed
// credentials access-control decision.
export const revealCredential = defineAction({
  accept: "form",
  input: z.object({
    credentialId: z.string().uuid(),
  }),
  handler: async ({ credentialId }, context) => {
    const user = requireUser(context.locals);
    const row = await getCredentialById(credentialId);
    if (!row) {
      throw new ActionError({ code: "NOT_FOUND", message: "Credential not found." });
    }

    let secret: string;
    try {
      secret = decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag });
    } catch {
      throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Unable to reveal credential right now." });
    }

    await db.insert(credentialReveals).values({ credentialId, revealedBy: user.id });

    return { secret };
  },
});
