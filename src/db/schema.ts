import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("users_email_idx").on(table.email),
]);

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Collections + Items: the unified content model ---
// A Collection is a simple top-level grouping (was "shelves"). An Item is
// everything that used to be split across books/chapters/pages (free-text
// wiki docs) and the separate assets table (typed CMDB records) — one
// entity, optionally typed, with structured fields, revisions, and an
// explicit relationship graph regardless of what kind of thing it documents.
// See CLAUDE.md for the consolidation rationale.

export const collections = pgTable("collections", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url").notNull(),
  // Free-text grouping label shown as a home-page section header (e.g.
  // "Clients", "Internal Departments") — replaces the old `shelves` table,
  // which was a near-1:1 wrapper around a single book and added a layer of
  // nesting without adding meaning.
  category: text("category"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  uniqueIndex("collections_slug_idx").on(table.slug),
]);

export interface PageDetail {
  category: string;
  label: string;
  value: string;
}

export interface RevisionChange {
  field: string;
  from: string;
  to: string;
}

export const itemTypes = [
  "document",
  "server",
  "storage-disk",
  "database",
  "application",
  "workstation",
  "network-device",
  "software-license",
  "service",
  "vehicle",
  "job",
  "other",
] as const;
export type ItemType = (typeof itemTypes)[number];

export const itemStatuses = ["active", "archived"] as const;
export type ItemStatus = (typeof itemStatuses)[number];

// Relationship is directed: itemId --[relationshipType]--> relatedItemId
// e.g. (web-01, "depends_on", switch-core-1), or (runbook, "references", web-01)
export const relationshipTypes = [
  "depends_on",
  "hosts",
  "connects_to",
  "runs_on",
  "licensed_for",
  "attached_to",
  "installed_on",
  "references",
] as const;
export type RelationshipType = (typeof relationshipTypes)[number];

export const items = pgTable("items", {
  id: uuid("id").defaultRandom().primaryKey(),
  collectionId: uuid("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
  type: text("type").notNull().$type<ItemType>(),
  // Free-text grouping within a collection (e.g. "Server Systems"), replaces
  // the old `chapters` join table — just a label on the item, no join needed.
  section: text("section"),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  region: text("region"),
  imageUrl: text("image_url"),
  warning: text("warning"),
  // Soft-delete: archived items stay auditable, never hard-deleted.
  status: text("status").notNull().default("active").$type<ItemStatus>(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  fields: jsonb("fields").$type<PageDetail[]>().notNull().default([]),
  photos: jsonb("photos").$type<string[]>().notNull().default([]),
  createdBy: uuid("created_by").references(() => users.id),
  updatedBy: uuid("updated_by").references(() => users.id),
  currentRevision: integer("current_revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("items_slug_idx").on(table.slug),
]);

export const itemRevisions = pgTable("item_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  revisionNo: integer("revision_no").notNull(),
  authorId: uuid("author_id").references(() => users.id),
  summary: text("summary").notNull(),
  fieldsSnapshot: jsonb("fields_snapshot").$type<PageDetail[]>().notNull().default([]),
  changes: jsonb("changes").$type<RevisionChange[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The relationship graph — an explicit join table, not prose links inside
// `fields`. DB-level guards: no self-references, no duplicate edges. Cycle
// detection across longer chains (A depends_on B depends_on C depends_on A)
// is enforced in src/lib/itemGraph.ts at write time, since Postgres check
// constraints can't express "no path back to the origin" across arbitrary depth.
export const itemRelationships = pgTable("item_relationships", {
  id: uuid("id").defaultRandom().primaryKey(),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  relatedItemId: uuid("related_item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  relationshipType: text("relationship_type").notNull().$type<RelationshipType>(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("item_relationships_unique_idx").on(
    table.itemId,
    table.relatedItemId,
    table.relationshipType,
  ),
  check("item_relationships_no_self_reference", sql`${table.itemId} <> ${table.relatedItemId}`),
]);

// --- Credentials (sensitive field type, per CLAUDE.md) ---
// Secrets are never stored in `items.fields`. Encrypted app-side (AES-256-GCM,
// see src/lib/credentialCrypto.ts) — ciphertext/iv/authTag only, key lives in
// an env var, never in this table. Masked-by-default in the UI; every decrypt
// is written to `credentialReveals` for an audit trail instead of gating
// access behind per-user RBAC (confirmed 2026-07-14, see CLAUDE.md).
export const credentials = pgTable("credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  username: text("username").notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const credentialReveals = pgTable("credential_reveals", {
  id: uuid("id").defaultRandom().primaryKey(),
  credentialId: uuid("credential_id").notNull().references(() => credentials.id, { onDelete: "cascade" }),
  revealedBy: uuid("revealed_by").references(() => users.id),
  revealedAt: timestamp("revealed_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Webhook ingest staging ---
// The deployable half of "event-driven ingestion": external systems POST a
// signed payload here and it lands in this table, NOT in `items`. Nothing
// reaches the documentation until a human reviews it at /ingest — a CMDB that
// silently rewrites itself from an unattended feed is how these tools lose
// their credibility as a record of what's actually true.
//
// Vercel's serverless runtime has no long-lived worker, so polling cloud APIs
// or holding a Kubernetes watch is out; a webhook receiver is the shape that
// actually fits the deployment (see CLAUDE.md — hosting is settled).

export const ingestStatuses = ["pending", "applied", "rejected"] as const;
export type IngestStatus = (typeof ingestStatuses)[number];

/** What a sender is asking us to record. Validated at the endpoint. */
export interface IngestPayload {
  name: string;
  type: ItemType;
  collectionSlug: string;
  section?: string;
  region?: string;
  fields: PageDetail[];
  photos?: string[];
}

export const ingestEvents = pgTable("ingest_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Free-text sender label (e.g. "hetzner-webhook", "ci-deploy") — a name for
  // the humans reviewing the queue, not an enum to keep in sync with senders.
  source: text("source").notNull(),
  // The sender's own id for this event, used to drop retries of a delivery
  // we've already stored.
  externalId: text("external_id"),
  payload: jsonb("payload").$type<IngestPayload>().notNull(),
  status: text("status").notNull().default("pending").$type<IngestStatus>(),
  // Set once applied, so the queue can link through to what it produced.
  itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
  note: text("note"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ingest_events_source_external_idx").on(table.source, table.externalId),
]);

// --- Customer approval links (public /f/[token]) ---
export const shareLinkStatuses = ["pending", "approved", "declined"] as const;
export type ShareLinkStatus = (typeof shareLinkStatuses)[number];

export const shareLinks = pgTable("share_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  token: text("token").notNull(),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending").$type<ShareLinkStatus>(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("share_links_token_idx").on(table.token),
]);
