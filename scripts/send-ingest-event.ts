import "dotenv/config";
import { signIngestRequest } from "../src/lib/ingestAuth";

/**
 * Reference sender for the webhook ingest endpoint — run it to check the
 * receiver end to end, or read it to see exactly what a real sender has to do
 * (sign `${timestamp}.${rawBody}`, send both headers, post the same bytes).
 *
 *   npx tsx scripts/send-ingest-event.ts [url]
 *
 * Reads INGEST_WEBHOOK_SECRET from the environment.
 */
const url = process.argv[2] ?? "http://localhost:4325/api/ingest";
const secret = process.env.INGEST_WEBHOOK_SECRET;
if (!secret) {
  console.error("INGEST_WEBHOOK_SECRET is not set.");
  process.exit(1);
}

const body = {
  source: "hetzner-webhook",
  externalId: `demo-${Date.now()}`,
  item: {
    name: "prod-hetzner-ashfall",
    type: "server",
    collectionSlug: process.argv[3] ?? "it-department",
    section: "Server Systems",
    region: "Hetzner FSN1",
    fields: [
      { category: "Compute", label: "CPU", value: "4 vCPU (Ampere Altra)" },
      { category: "Compute", label: "Memory", value: "8 GB" },
      { category: "Storage & Backup", label: "Storage", value: "80 GB NVMe" },
      { category: "Operations", label: "Operating System", value: "Ubuntu 24.04 LTS" },
    ],
  },
};

// The signature covers the exact bytes sent, so serialize once and reuse.
const rawBody = JSON.stringify(body);
const timestamp = Math.floor(Date.now() / 1000).toString();

const response = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-nimbusvault-timestamp": timestamp,
    "x-nimbusvault-signature": signIngestRequest(secret, timestamp, rawBody),
  },
  body: rawBody,
});

console.log(response.status, await response.text());
