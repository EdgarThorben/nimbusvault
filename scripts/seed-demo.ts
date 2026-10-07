// Prototype data: Leo's demo login plus a believable day in the workshop.
// Wipes all workshop data first, and only ever runs against the leos_workshop database.
//   npm run db:seed-demo
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { approvals, customers, jobs, lineItems, users, vehicles, type JobStatus, type LineItemKind } from "../src/db/schema";
import { DEMO_LOGIN } from "../src/config";
import { hashPassword } from "../src/lib/auth";

const { rows } = await db.execute<{ db: string }>(sql`select current_database() as db`);
if (rows[0]?.db !== "leos_workshop") {
  console.error(`Refusing to seed: connected to "${rows[0]?.db}", expected "leos_workshop".`);
  process.exit(1);
}

type Line = [description: string, kind: LineItemKind, qty: number, unitEuros: number];
interface Example {
  plate: string;
  car: string;
  customer: [name: string, phone: string, email: string];
  title: string;
  status: JobStatus;
  findings: string;
  lines: Line[];
  daysAgo?: number;
  invoice?: number;
}

const examples: Example[] = [
  {
    plate: "B-LW 2041", car: "VW Golf VII", customer: ["Anna Becker", "0151 23456781", "anna.becker@example.com"],
    title: "Front brakes", status: "awaiting_approval",
    findings: "Front discs below minimum thickness, pads at 2 mm. Replace both.",
    lines: [["Front brake discs", "part", 2, 48.9], ["Front brake pads (set)", "part", 1, 39.5], ["Labour", "labour", 1.5, 79]],
  },
  {
    plate: "B-KM 318", car: "Opel Corsa E", customer: ["Mehmet Kaya", "0160 9876543", ""],
    title: "Service + oil change", status: "in_progress",
    findings: "Annual service. Wiper blades worn, customer agreed to replace.",
    lines: [["Engine oil 5W-30", "part", 4, 11.9], ["Oil filter", "part", 1, 9.8], ["Wiper blades (pair)", "part", 1, 24.9], ["Labour", "labour", 1, 79]],
  },
  {
    plate: "P-JS 77", car: "BMW 320d", customer: ["Julia Schmidt", "0176 5554433", "julia.schmidt@example.com"],
    title: "Air conditioning", status: "awaiting_approval",
    findings: "A/C blows warm. Leak test shows the condenser is leaking at the lower seam.",
    lines: [["A/C condenser", "part", 1, 189], ["Refrigerant R1234yf (500 g)", "part", 1, 64], ["Labour", "labour", 2.5, 79]],
  },
  {
    plate: "B-TF 9003", car: "Ford Fiesta", customer: ["Tom Fischer", "0152 1112223", ""],
    title: "Tyre change", status: "in_progress",
    findings: "Swap to winter tyres from storage. Rear left valve replaced.",
    lines: [["Tyre change and balancing", "labour", 1, 79], ["Valve", "part", 1, 4.5]],
  },
  {
    plate: "B-SW 512", car: "Skoda Octavia", customer: ["Sabine Wolf", "0171 3332211", "s.wolf@example.com"],
    title: "Timing belt", status: "ready",
    findings: "Timing belt and water pump replaced at 120,000 km as scheduled.",
    lines: [["Timing belt kit", "part", 1, 159], ["Water pump", "part", 1, 89], ["Coolant", "part", 2, 12.5], ["Labour", "labour", 3.5, 79]],
  },
  {
    plate: "B-LW 2041", car: "VW Golf VII", customer: ["Anna Becker", "0151 23456781", "anna.becker@example.com"],
    title: "Battery replacement", status: "invoiced", daysAgo: 12, invoice: 1,
    findings: "Battery failed load test. Replaced.",
    lines: [["Battery 60 Ah", "part", 1, 119], ["Labour", "labour", 0.5, 79]],
  },
];

await db.execute(sql`truncate approvals, line_items, job_photos, jobs, vehicles, customers, sessions`);
await db.execute(sql`delete from users`);
await db.insert(users).values({
  email: DEMO_LOGIN.email,
  passwordHash: await hashPassword(DEMO_LOGIN.password),
  displayName: "Leo",
});

const vehicleIds = new Map<string, string>();
for (const ex of examples) {
  let vehicleId = vehicleIds.get(ex.plate);
  if (!vehicleId) {
    const [name, phone, email] = ex.customer;
    const [c] = await db.insert(customers).values({ name, phone, email }).returning();
    const [v] = await db.insert(vehicles).values({ plate: ex.plate, makeModel: ex.car, customerId: c.id }).returning();
    vehicleId = v.id;
    vehicleIds.set(ex.plate, vehicleId);
  }

  const created = new Date(Date.now() - (ex.daysAgo ?? 0) * 86_400_000);
  const [job] = await db
    .insert(jobs)
    .values({
      vehicleId,
      title: ex.title,
      status: ex.status,
      findings: ex.findings,
      createdAt: created,
      updatedAt: created,
      invoiceNumber: ex.invoice ?? null,
      invoicedAt: ex.invoice ? created : null,
    })
    .returning();

  await db.insert(lineItems).values(
    ex.lines.map(([description, kind, qty, euros], i) => ({
      jobId: job.id, description, kind, qty, unitPriceCents: Math.round(euros * 100), sortOrder: i,
    })),
  );

  if (ex.status !== "checked_in") {
    const approved = ex.status !== "awaiting_approval";
    const token = randomBytes(24).toString("base64url");
    await db.insert(approvals).values({
      jobId: job.id,
      token,
      decision: approved ? "approved" : null,
      decidedAt: approved ? created : null,
    });
    if (ex.status === "awaiting_approval") console.log(`Customer link (${ex.plate}): /a/${token}`);
  }
}

console.log(`Seeded ${examples.length} jobs. Demo login: ${DEMO_LOGIN.email} / ${DEMO_LOGIN.password}`);
process.exit(0);
