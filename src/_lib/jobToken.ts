// Credential for the internal job endpoint (POST /api/internal/jobs/<name>).
//
// The Worker's `scheduled` handler and the Next.js route both hold
// AUTH_SECRET, so the token is derived from it (HMAC-SHA-256) instead of
// being one more secret to configure. It is bound to the job name, and
// knowing it reveals nothing about AUTH_SECRET.
//
// Web Crypto only: shared by the Worker entry and the app.

export const JOBS_ROUTE_PREFIX = "/api/internal/jobs";

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
