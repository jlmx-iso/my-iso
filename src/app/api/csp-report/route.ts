import { SITE_URL } from "~/_lib/site";
import {
  actionableViolations,
  CSP_REPORT_LIMIT,
  MAX_CSP_REPORT_BYTES,
  parseCspReports,
  readBodyCapped,
} from "~/server/_lib/cspReport";
import { captureEvent } from "~/server/_lib/posthog";
import { getClientIp } from "~/server/_utils/clientIp";
import { checkRateLimit } from "~/server/_utils/rateLimit";
import { db } from "~/server/db";

/** Reports are anonymous: one shared id, and no person profile. */
const DISTINCT_ID = "csp-report";

function empty(status: number): Response {
  return new Response(null, { headers: { "Cache-Control": "no-store" }, status });
}

/**
 * Receives Content-Security-Policy violation reports from browsers (the
 * `report-uri` / `report-to` target in src/securityHeaders.js) and forwards
 * them to PostHog as `csp_violation` events, so violations are visible
 * while the policy is still report-only.
 *
 * Unauthenticated by nature, so it is size-capped, rate-limited per client
 * address, and keeps only a few fields of each report.
 *
 * Nothing personal is recorded. Browsers send reports without cookies, and
 * each event carries only: the directive, the disposition, the blocked
 * resource and the script's file (origin and path, or a keyword such as
 * "eval"), the document's path (no query string or fragment) and a line
 * number. All reports share one distinct id and create no person profile;
 * the client address is used for the rate-limit key (hashed) and is not
 * sent.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readBodyCapped(request, MAX_CSP_REPORT_BYTES);
  if (body === null) return empty(413);

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return empty(400);
  }

  // Known probes are dropped before the rate-limit write: they come with
  // every page view of some pages and need neither a database write nor an
  // event.
  // The app's own origins: the public one, and the one this request came to
  // (they differ only locally or on a preview address).
  const appOrigins = new Set([new URL(SITE_URL).origin, new URL(request.url).origin]);
  const violations = actionableViolations(parseCspReports(payload), appOrigins);
  if (violations.length === 0) return empty(204);

  const limit = await checkRateLimit(db, CSP_REPORT_LIMIT, `ip:${getClientIp(request.headers)}`);
  if (!limit.allowed) return empty(429);

  for (const violation of violations) {
    captureEvent(DISTINCT_ID, "csp_violation", {
      ...violation,
      $process_person_profile: false,
    });
  }
  return empty(204);
}
