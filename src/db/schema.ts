import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

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

export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vehicles = pgTable("vehicles", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Stored normalized (upper case, single spaces) so a re-check-in finds the same car.
  plate: text("plate").notNull(),
  makeModel: text("make_model").notNull().default(""),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("vehicles_plate_idx").on(table.plate),
]);

export const jobStatuses = [
  "checked_in",
  "awaiting_approval",
  "approved",
  "in_progress",
  "ready",
  "invoiced",
] as const;
export type JobStatus = (typeof jobStatuses)[number];

export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  title: text("title").notNull(),
  status: text("status").notNull().default("checked_in").$type<JobStatus>(),
  findings: text("findings").notNull().default(""),
  invoiceNumber: integer("invoice_number"),
  invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("jobs_invoice_number_idx").on(table.invoiceNumber),
  index("jobs_created_at_idx").on(table.createdAt),
]);

export const jobPhotos = pgTable("job_photos", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  // Pathname inside the private Vercel Blob store, served through /p/[...path].
  pathname: text("pathname").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("job_photos_pathname_idx").on(table.pathname),
]);

export const lineItemKinds = ["part", "labour"] as const;
export type LineItemKind = (typeof lineItemKinds)[number];

export const lineItems = pgTable("line_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  kind: text("kind").notNull().$type<LineItemKind>(),
  qty: numeric("qty", { precision: 10, scale: 2, mode: "number" }).notNull(),
  // Net price per unit in cents; VAT is added at display/invoice time (see src/config.ts).
  unitPriceCents: integer("unit_price_cents").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const approvalDecisions = ["approved", "declined"] as const;
export type ApprovalDecision = (typeof approvalDecisions)[number];

export const approvals = pgTable("approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  decision: text("decision").$type<ApprovalDecision>(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("approvals_token_idx").on(table.token),
]);
