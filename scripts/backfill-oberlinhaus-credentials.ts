// One-off backfill: moves the demo "Passwort-Hash (Demo)" fields (raw argon2 hash text,
// publicly visible, unmasked) that were previously seeded directly into items.fields into
// real encrypted `credentials` rows (masked-by-default, reveal-on-demand), matching what
// scripts/seed.ts now does for fresh seeds. Safe to re-run — skips items that no longer
// have the field, and skips credentials that already exist.
import "dotenv/config";
import { eq, and } from "drizzle-orm";
import { db } from "../src/db/client";
import { credentials, items, users } from "../src/db/schema";
import type { PageDetail } from "../src/db/schema";
import { encryptSecret } from "../src/lib/credentialCrypto";

const ADMIN_DEMO_SECRET = "Obh-Admin-Demo-Only-2026!";
const SERVICE_DEMO_SECRET = "Obh-Service-Demo-Only-2026!";

const targets = [
  { slug: "pve-unitcloud-potsdam-01", label: "Admin-Login", username: "obh-cluster-admin", secret: ADMIN_DEMO_SECRET },
  { slug: "vm-bewohnerverwaltung", label: "Service-Account", username: "svc-bewohnerverwaltung", secret: SERVICE_DEMO_SECRET },
  { slug: "vm-schulverwaltung", label: "Service-Account", username: "svc-schulverwaltung", secret: SERVICE_DEMO_SECRET },
  { slug: "vm-fileserver-potsdam", label: "Service-Account", username: "svc-fileserver-potsdam", secret: SERVICE_DEMO_SECRET },
  { slug: "vm-personalverwaltung", label: "Service-Account", username: "svc-personalverwaltung", secret: SERVICE_DEMO_SECRET },
  { slug: "pbx-3cx-oberlinhaus", label: "Admin-Login", username: "obh-pbx-admin", secret: ADMIN_DEMO_SECRET },
  { slug: "vpn-gateway-oberlinhaus", label: "Admin-Login", username: "obh-vpn-admin", secret: ADMIN_DEMO_SECRET },
  { slug: "backup-dr-node-nuernberg", label: "Admin-Login", username: "obh-dr-admin", secret: ADMIN_DEMO_SECRET },
];

async function main() {
  const [michael] = await db.select({ id: users.id }).from(users).where(eq(users.email, "michael@michi.ws")).limit(1);
  if (!michael) throw new Error("Expected user michael@michi.ws to exist — run seed.ts first.");

  let fieldsStripped = 0;
  let credentialsCreated = 0;
  let skipped = 0;

  for (const t of targets) {
    const [item] = await db.select().from(items).where(eq(items.slug, t.slug)).limit(1);
    if (!item) {
      console.log(`SKIP ${t.slug}: item not found`);
      skipped++;
      continue;
    }

    const fields = (item.fields ?? []) as PageDetail[];
    const hasHashField = fields.some((f) => f.label === "Passwort-Hash (Demo)");
    if (hasHashField) {
      const stripped = fields.filter((f) => f.label !== "Passwort-Hash (Demo)");
      await db.update(items).set({ fields: stripped }).where(eq(items.id, item.id));
      fieldsStripped++;
      console.log(`Stripped raw hash field from ${t.slug}`);
    }

    const [existing] = await db
      .select({ id: credentials.id })
      .from(credentials)
      .where(and(eq(credentials.itemId, item.id), eq(credentials.label, t.label)))
      .limit(1);

    if (existing) {
      console.log(`SKIP ${t.slug}: credential "${t.label}" already exists`);
      skipped++;
      continue;
    }

    const encrypted = encryptSecret(t.secret);
    await db.insert(credentials).values({
      itemId: item.id,
      label: t.label,
      username: t.username,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      createdBy: michael.id,
    });
    credentialsCreated++;
    console.log(`Created encrypted credential for ${t.slug}`);
  }

  console.log(`\nDone. Fields stripped: ${fieldsStripped}, credentials created: ${credentialsCreated}, skipped: ${skipped}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
