// Credential for the internal job endpoint (POST /api/internal/jobs/<name>).
//
// The Worker's `scheduled` handler and the Next.js route both hold
// AUTH_SECRET, so the token is derived from it (HMAC-SHA-256) instead of
// being one more secret to configure. It is bound to the job name, and
// knowing it reveals nothing about AUTH_SECRET.
//
// Web Crypto only: shared by the Worker entry and the app.

export const JOBS_ROUTE_PREFIX = "/api/internal/jobs";

/** Decodes each path segment that can be decoded; leaves the others as sent. */
function decodeSegments(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

/**
 * Whether a request path reaches the internal job endpoint, in any spelling
 * a router might accept: percent-encoded characters (also encoded twice),
 * an encoded or doubled slash, a backslash, dot segments, a trailing slash
 * or other letter case. The Worker refuses all of them from outside, so the
 * check errs towards matching.
 */
export function isJobsRoutePath(pathname: string): boolean {
  let path = pathname;
  // Bounded: each round removes at least one level of encoding.
  for (let round = 0; round < 4; round += 1) {
    const decoded = decodeSegments(path);
    // A decoded "/" (from %2F) splits a segment; decode the new segments too.
    if (decoded === path) break;
    path = decoded;
  }

  let normalised = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  try {
    // Resolves "." and ".." segments the way the URL parser does.
    normalised = new URL(normalised.startsWith("/") ? normalised : `/${normalised}`, "http://x").pathname;
  } catch {
    // Keep what we have.
  }
  normalised = normalised.replace(/\/{2,}/g, "/").toLowerCase();

  return normalised === JOBS_ROUTE_PREFIX || normalised.startsWith(`${JOBS_ROUTE_PREFIX}/`);
}

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function jobToken(secret: string, jobName: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`scheduled-job\u0000${jobName}`),
  );
  return toHex(new Uint8Array(signature));
}
