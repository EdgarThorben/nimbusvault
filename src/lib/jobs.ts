import { and, asc, desc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import { DEFAULT_COUNTRY_CODE } from "../config";
import { db } from "../db/client";
import {
  approvals,
  customers,
  jobPhotos,
  jobs,
  lineItems,
  vehicles,
  type JobStatus,
} from "../db/schema";

export const TIMEZONE = "Europe/Berlin";

export const statusLabel: Record<JobStatus, string> = {
  checked_in: "Checked in",
  awaiting_approval: "Needs approval",
  approved: "Approved",
  in_progress: "In progress",
  ready: "Ready",
  invoiced: "Invoiced",
};

export const statusTone: Record<JobStatus, "neutral" | "wait" | "work" | "done"> = {
  checked_in: "neutral",
  awaiting_approval: "wait",
  approved: "work",
  in_progress: "work",
  ready: "done",
  invoiced: "neutral",
};

export function normalizePlate(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, " ");
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** Digits for wa.me: "+49 151 …" / "0049…" / "0151…" → "49151…". Empty if no usable number. */
export function whatsappNumber(phone: string): string {
  const trimmed = phone.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  if (trimmed.startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return DEFAULT_COUNTRY_CODE + digits.slice(1);
  return digits;
}

export function invoiceLabel(n: number): string {
  return `LW-${String(n).padStart(4, "0")}`;
}

const jobBase = {
  id: jobs.id,
  title: jobs.title,
  status: jobs.status,
  findings: jobs.findings,
  invoiceNumber: jobs.invoiceNumber,
  invoicedAt: jobs.invoicedAt,
  createdAt: jobs.createdAt,
  plate: vehicles.plate,
  makeModel: vehicles.makeModel,
  customerId: customers.id,
  customerName: customers.name,
  customerPhone: customers.phone,
  customerEmail: customers.email,
};

function jobSelect() {
  return db
    .select(jobBase)
    .from(jobs)
    .innerJoin(vehicles, eq(jobs.vehicleId, vehicles.id))
    .innerJoin(customers, eq(vehicles.customerId, customers.id));
}

const startOfToday = sql`(date_trunc('day', now() at time zone ${TIMEZONE}) at time zone ${TIMEZONE})`;

/** Everything still on the floor, plus whatever was checked in today. */
export async function listBoardJobs() {
  return jobSelect()
    .where(or(ne(jobs.status, "invoiced"), gte(jobs.createdAt, startOfToday)))
    .orderBy(desc(jobs.createdAt));
}

export async function listInvoiceJobs() {
  const rows = await jobSelect()
    .where(inArray(jobs.status, ["approved", "in_progress", "ready", "invoiced"]))
    .orderBy(desc(jobs.invoicedAt), desc(jobs.createdAt));
  const lines = rows.length
    ? await db.select().from(lineItems).where(inArray(lineItems.jobId, rows.map((r) => r.id)))
    : [];
  return rows.map((r) => ({ ...r, lines: lines.filter((l) => l.jobId === r.id) }));
}

export async function getJob(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [job] = await jobSelect().where(eq(jobs.id, id)).limit(1);
  if (!job) return null;
  const [photos, lines, latestApproval] = await Promise.all([
    db.select().from(jobPhotos).where(eq(jobPhotos.jobId, id)).orderBy(asc(jobPhotos.createdAt)),
    db.select().from(lineItems).where(eq(lineItems.jobId, id)).orderBy(asc(lineItems.sortOrder)),
    getLatestApproval(id),
  ]);
  return { ...job, photos, lines, latestApproval };
}

export async function getLatestApproval(jobId: string) {
  const [row] = await db
    .select()
    .from(approvals)
    .where(eq(approvals.jobId, jobId))
    .orderBy(desc(approvals.createdAt))
    .limit(1);
  return row ?? null;
}

/** Resolves a customer token to its job. `current` is false once a newer link was sent. */
export async function getJobByToken(token: string) {
  const [approval] = await db.select().from(approvals).where(eq(approvals.token, token)).limit(1);
  if (!approval) return null;
  const job = await getJob(approval.jobId);
  if (!job) return null;
  return { approval, job, current: job.latestApproval?.id === approval.id };
}

export async function listCustomers() {
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      plate: vehicles.plate,
      makeModel: vehicles.makeModel,
    })
    .from(customers)
    .leftJoin(vehicles, eq(vehicles.customerId, customers.id))
    .orderBy(asc(customers.name));
  const byId = new Map<string, { id: string; name: string; phone: string; email: string; cars: string[] }>();
  for (const r of rows) {
    const c = byId.get(r.id) ?? { id: r.id, name: r.name, phone: r.phone, email: r.email, cars: [] };
    if (r.plate) c.cars.push([r.plate, r.makeModel].filter(Boolean).join(" · "));
    byId.set(r.id, c);
  }
  return [...byId.values()];
}

export async function photoBelongsToToken(pathname: string, token: string) {
  const [row] = await db
    .select({ id: jobPhotos.id })
    .from(jobPhotos)
    .innerJoin(approvals, eq(approvals.jobId, jobPhotos.jobId))
    .where(and(eq(jobPhotos.pathname, pathname), eq(approvals.token, token)))
    .limit(1);
  return !!row;
}
