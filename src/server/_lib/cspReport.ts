// Content-Security-Policy violation reports, reduced to a few safe fields
// before they are forwarded to PostHog (see /api/csp-report).

import type { RateLimitPolicy } from "~/server/_utils/rateLimit";

/** Largest report body read. Real reports are well under 2 KiB. */
export const MAX_CSP_REPORT_BYTES = 16 * 1024;

/** Reports taken from one request (the Reporting API batches them). */
export const MAX_REPORTS_PER_REQUEST = 5;

/**
 * Per client address. A broken page can fire the same violation on every
 * load; a handful per client is enough to see it. Fails closed: with the
 * limiter down, reports are dropped rather than forwarded unthrottled.
 */
export const CSP_REPORT_LIMIT = {
  limit: 20,
  name: "csp-report",
  onError: "deny",
  windowSeconds: 10 * 60,
} as const satisfies RateLimitPolicy;

const MAX_FIELD_LENGTH = 200;

export type CspViolation = {
  blocked: string | null;
  directive: string | null;
  disposition: string | null;
  documentPath: string | null;
  lineNumber: number | null;
  sourceFile: string | null;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_FIELD_LENGTH) : null;
}

/**
 * A URL without its query string and fragment, which can carry tokens and
 * email addresses. Keywords browsers report instead of a URL ("inline",
 * "eval", "data") pass through; anything else unparseable is dropped.
 */
function safeUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (/^[a-z-]+$/i.test(raw)) return raw.toLowerCase();
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "wss:") {
      return url.protocol.replace(":", "");
    }
    return `${url.origin}${url.pathname}`.slice(0, MAX_FIELD_LENGTH);
  } catch {
    return null;
  }
}

function pathOf(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    return new URL(raw).pathname.slice(0, MAX_FIELD_LENGTH);
  } catch {
    return null;
  }
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fromBody(body: Record<string, unknown>): CspViolation | null {
  // `report-uri` uses kebab-case keys, the Reporting API camelCase.
  const violation: CspViolation = {
    blocked: safeUrl(body["blocked-uri"] ?? body.blockedURL),
    directive: text(body["effective-directive"] ?? body.effectiveDirective ?? body["violated-directive"]),
    disposition: text(body.disposition),
    documentPath: pathOf(body["document-uri"] ?? body.documentURL),
    lineNumber: integer(body["line-number"] ?? body.lineNumber),
    sourceFile: safeUrl(body["source-file"] ?? body.sourceFile),
  };
  // Without a directive there is nothing to act on.
  return violation.directive ? violation : null;
}

/**
 * Extracts violations from a report body in either format browsers send:
 * `{"csp-report": {...}}` (the `report-uri` directive) or
 * `[{"type": "csp-violation", "body": {...}}]` (the Reporting API).
 * Anything else yields an empty list. Script samples are never kept.
 */
export function parseCspReports(payload: unknown): CspViolation[] {
  const bodies: unknown[] = [];
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      if (isRecord(entry) && entry.type === "csp-violation") bodies.push(entry.body);
    }
  } else if (isRecord(payload)) {
    bodies.push(payload["csp-report"]);
  }

  const violations: CspViolation[] = [];
  for (const body of bodies) {
    if (violations.length >= MAX_REPORTS_PER_REQUEST) break;
    const violation = isRecord(body) ? fromBody(body) : null;
    if (violation) violations.push(violation);
  }
  return violations;
}

/**
 * A library feature probe, not a problem to act on: code in the app's own
 * bundle (`/_next/static/...`, or no source reported) trying `eval` /
 * `new Function`. Zod 4 does this once per page to decide whether it may
 * compile its parsers; the throw is caught, but the browser still reports
 * it. The app never evaluates code itself (script-src has no
 * 'unsafe-eval' on purpose), so a first-party eval report is always such a
 * probe. An eval from a script elsewhere is still reported.
 */
export function isFirstPartyEvalProbe(violation: CspViolation): boolean {
  if (violation.blocked !== "eval") return false;
  if (!violation.directive?.startsWith("script-src")) return false;
  if (violation.sourceFile === null) return true;
  try {
    return new URL(violation.sourceFile).pathname.startsWith("/_next/static/");
  } catch {
    return false;
  }
}

/** The violations worth recording: everything but known probes. */
export function actionableViolations(violations: CspViolation[]): CspViolation[] {
  return violations.filter((violation) => !isFirstPartyEvalProbe(violation));
}

/**
 * Reads at most `limit` bytes of a request body as text. Returns null when
 * the body is larger, so an oversized upload is never buffered.
 */
export async function readBodyCapped(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let result = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel();
      return null;
    }
    result += decoder.decode(value, { stream: true });
  }
  return result + decoder.decode();
}
