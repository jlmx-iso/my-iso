#!/usr/bin/env node
/**
 * Re-derives stored subscription rows from Stripe, batch by batch, by
 * calling the admin procedure `subscription.resyncFromStripe` on a running
 * deployment until it reports that nothing is left. See docs/BILLING.md
 * ("After deploying").
 *
 * The work happens in the app (which has the database and the Stripe key);
 * this script only drives it. It is safe to run again and to interrupt.
 *
 * Usage:
 *
 *   RESYNC_COOKIE='__Secure-authjs.session-token=...' \
 *     node scripts/billing-resync.mjs --url https://app.example.com [--scope pending|all] [--limit 10]
 *
 * Sign in to the app as a founder or ambassador and copy the session cookie
 * from the browser (never commit or log it), or pass a bearer token in
 * RESYNC_AUTHORIZATION ("Bearer ..."). Exit code 0 when every batch ran,
 * 1 on the first batch that failed (run it again to continue).
 */

const args = process.argv.slice(2);

/**
 * @param {string} name
 * @param {string | undefined} fallback
 * @returns {string | undefined}
 */
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return (index >= 0 ? args[index + 1] : undefined) ?? fallback;
};

const baseUrl = option("url", process.env.RESYNC_URL);
const scope = option("scope", "pending") ?? "pending";
const limit = Number(option("limit", "10"));
const cookie = process.env.RESYNC_COOKIE;
const authorization = process.env.RESYNC_AUTHORIZATION;

if (!baseUrl || (!cookie && !authorization) || !["pending", "all"].includes(scope) || !Number.isInteger(limit)) {
  console.error(
    "Usage: RESYNC_COOKIE='<session cookie>' node scripts/billing-resync.mjs --url <app origin> [--scope pending|all] [--limit 1-10]",
  );
  process.exit(2);
}

/** @typedef {{ nextCursor: string | null, outcomes: Record<string, number>, processed: number }} Batch */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isObject = (value) => typeof value === "object" && value !== null;

/**
 * The batch result out of a tRPC response body, or null if it is not one.
 * @param {unknown} body
 * @returns {Batch | null}
 */
function batchOf(body) {
  if (!isObject(body) || !isObject(body.result) || !isObject(body.result.data)) return null;
  const batch = body.result.data.json;
  if (!isObject(batch) || typeof batch.processed !== "number" || !isObject(batch.outcomes)) return null;
  /** @type {Record<string, number>} */
  const outcomes = {};
  for (const [outcome, count] of Object.entries(batch.outcomes)) {
    if (typeof count === "number") outcomes[outcome] = count;
  }
  return {
    nextCursor: typeof batch.nextCursor === "string" ? batch.nextCursor : null,
    outcomes,
    processed: batch.processed,
  };
}

/**
 * The error message out of a tRPC response body.
 * @param {unknown} body
 * @returns {string | null}
 */
function errorOf(body) {
  if (!isObject(body) || !isObject(body.error) || !isObject(body.error.json)) return null;
  return typeof body.error.json.message === "string" ? body.error.json.message : null;
}

const endpoint = new URL("/api/trpc/subscription.resyncFromStripe", baseUrl);
/** @type {Record<string, number>} */
const totals = {};
let processed = 0;
let batches = 0;
/** @type {string | null} */
let cursor = null;

do {
  /** @type {Record<string, string>} */
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (authorization) headers.authorization = authorization;

  /** @type {Response} */
  const response = await fetch(endpoint, {
    body: JSON.stringify({ json: { cursor, limit, scope } }),
    headers,
    method: "POST",
  });
  /** @type {unknown} */
  const body = await response.json().catch(() => null);
  const batch = response.ok ? batchOf(body) : null;
  if (!batch) {
    console.error(`Batch ${batches + 1} failed: ${errorOf(body) ?? `HTTP ${response.status}`}`);
    if (cursor) console.error(`Stopped after row ${cursor}. Running the script again is safe.`);
    process.exit(1);
  }

  batches += 1;
  processed += batch.processed;
  for (const [outcome, count] of Object.entries(batch.outcomes)) {
    totals[outcome] = (totals[outcome] ?? 0) + count;
  }
  console.log(`batch ${batches}: ${batch.processed} row(s) ${JSON.stringify(batch.outcomes)}`);
  cursor = batch.nextCursor;
} while (cursor);

console.log(`Done: ${processed} row(s) in ${batches} batch(es). Outcomes: ${JSON.stringify(totals)}`);
if (totals.failed) console.log("Some rows failed (see the app's error log); run the script again to retry them.");
if (totals.unknown_customer) {
  console.log("unknown_customer rows were left unchanged: their user has no stored Stripe customer id (docs/BILLING.md).");
}
