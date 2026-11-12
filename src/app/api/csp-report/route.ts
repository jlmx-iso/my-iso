import {
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

  const violations = parseCspReports(payload);
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
