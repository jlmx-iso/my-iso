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
 * RESYNC_AUTHORIZATION ("Bearer ...").
 *
 * Exit code, so that a deployment job cannot take an incomplete re-sync
 * for a finished one:
 *
 *   0  every batch ran and every row is settled
 *   1  a batch could not be run, or at least one row FAILED (Stripe or the
 *      database was unavailable for it): run the script again
 *   2  wrong usage
 *   3  nothing failed, but rows are left that need a person (their ids and
 *      outcomes are printed; see docs/BILLING.md)
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

/** @typedef {{ id: string, outcome: string }} Unresolved */
/** @typedef {{ nextCursor: string | null, outcomes: Record<string, number>, processed: number, unresolved: Unresolved[] }} Batch */

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
  /** @type {Unresolved[]} */
  const unresolved = [];
  for (const row of Array.isArray(batch.unresolved) ? batch.unresolved : []) {
    if (isObject(row) && typeof row.id === "string" && typeof row.outcome === "string") {
      unresolved.push({ id: row.id, outcome: row.outcome });
    }
  }
  return {
    nextCursor: typeof batch.nextCursor === "string" ? batch.nextCursor : null,
    outcomes,
    processed: batch.processed,
    unresolved,
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
/** @type {Unresolved[]} */
const unresolved = [];
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
  unresolved.push(...batch.unresolved);
  console.log(`batch ${batches}: ${batch.processed} row(s) ${JSON.stringify(batch.outcomes)}`);
  cursor = batch.nextCursor;
} while (cursor);

console.log(`Done: ${processed} row(s) in ${batches} batch(es). Outcomes: ${JSON.stringify(totals)}`);

const failed = unresolved.filter((row) => row.outcome === "failed");
const needAttention = unresolved.filter((row) => row.outcome !== "failed");
if (needAttention.length > 0) {
  console.error(`${needAttention.length} row(s) are not settled and need a person (docs/BILLING.md, "Outcomes"):`);
  for (const row of needAttention) console.error(`  Subscription ${row.id}: ${row.outcome}`);
}
if (failed.length > 0 || totals.failed) {
  console.error(`${failed.length || totals.failed} row(s) FAILED (see the app's error log). The re-sync is NOT complete; run the script again:`);
  for (const row of failed) console.error(`  Subscription ${row.id}`);
  process.exit(1);
}
if (needAttention.length > 0) process.exit(3);
