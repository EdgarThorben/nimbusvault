import { createHmac, timingSafeEqual } from "node:crypto";

// Request signing for the webhook ingest endpoint. Same approach as the
// credential crypto (Node `crypto` + an env-var key, no external service, per
// CLAUDE.md): the sender HMACs the timestamp and the raw body, we recompute
// and compare. The timestamp is inside the signed material so a captured
// request can't be replayed later with a fresh header.

const SIGNATURE_HEADER = "x-nimbusvault-signature";
const TIMESTAMP_HEADER = "x-nimbusvault-timestamp";

/** How far a request's timestamp may drift before we refuse it. */
const MAX_SKEW_SECONDS = 300;

export type VerifyResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; reason: string };

function getSecret(): string | undefined {
  return import.meta.env?.INGEST_WEBHOOK_SECRET ?? process.env.INGEST_WEBHOOK_SECRET;
}

export function isIngestConfigured(): boolean {
  return !!getSecret();
}

/** The value a sender puts in the signature header, given the same inputs. */
export function signIngestRequest(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/**
 * Verifies an inbound webhook. Takes the raw body text — re-serializing parsed
 * JSON would change byte-for-byte what was signed (key order, whitespace) and
 * every signature would fail.
 */
export function verifyIngestRequest(request: Request, rawBody: string): VerifyResult {
  const secret = getSecret();
  if (!secret) {
    // Unconfigured is a deployment problem, not a caller problem — say so with
    // a 503 rather than pretending the caller's signature was wrong.
    return { ok: false, status: 503, reason: "Ingest endpoint is not configured." };
  }

  const timestamp = request.headers.get(TIMESTAMP_HEADER);
  const signature = request.headers.get(SIGNATURE_HEADER);
  if (!timestamp || !signature) {
    return { ok: false, status: 401, reason: "Missing signature headers." };
  }

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) {
    return { ok: false, status: 401, reason: "Malformed timestamp." };
  }
  if (Math.abs(Date.now() / 1000 - sentAt) > MAX_SKEW_SECONDS) {
    return { ok: false, status: 401, reason: "Timestamp outside the accepted window." };
  }

  const expected = Buffer.from(signIngestRequest(secret, timestamp, rawBody), "utf8");
  const provided = Buffer.from(signature, "utf8");
  // timingSafeEqual throws on a length mismatch, so check that first — and
  // compare rather than short-circuiting on the first differing byte.
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, status: 401, reason: "Signature did not match." };
  }

  return { ok: true };
}
