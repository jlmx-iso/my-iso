/**
 * Cheap checks on a tRPC HTTP request, made before tRPC parses anything.
 *
 * Shared with the client (src/trpc/react.tsx imports MAX_TRPC_BATCH_SIZE), so
 * this module must stay free of server-only imports.
 */

/** Most procedures one HTTP request may carry. */
export const MAX_TRPC_BATCH_SIZE = 10;

/**
 * Largest request body accepted. The biggest legitimate payload is one
 * base64-encoded 5 MB image (about 6.7 MB) plus a little JSON.
 */
export const MAX_TRPC_BODY_BYTES = 8 * 1024 * 1024;

function reject(status: number, message: string): Response {
  return Response.json(
    { error: { message } },
    { headers: { "Cache-Control": "no-store" }, status },
  );
}

/** Number of procedures addressed by a tRPC URL path ("a.b,c.d" is two). */
export function countBatchedProcedures(pathname: string, endpoint: string): number {
  const prefix = endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
  const procedures = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
  return decodeURIComponent(procedures).split(",").filter(Boolean).length;
}

/**
 * Returns a rejection response for a request the tRPC endpoint must not
 * process, or null to let it through.
 *
 * - Oversized bodies are refused up front (413).
 * - Batches are capped (also enforced by tRPC's own `maxBatchSize`).
 * - Mutations cannot be batched at all: one HTTP request, one state change.
 *   Per-request controls (rate limits, attempt counters) then cannot be
 *   multiplied by packing many calls into one request. tRPC sends mutations
 *   as POST and queries as GET.
 */
export function guardTrpcRequest(request: Request, endpoint: string): Response | null {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_TRPC_BODY_BYTES) {
    return reject(413, "Request body too large");
  }

  const url = new URL(request.url);
  let batched: number;
  try {
    batched = countBatchedProcedures(url.pathname, endpoint);
  } catch {
    return reject(400, "Malformed request path");
  }

  if (batched > MAX_TRPC_BATCH_SIZE) {
    return reject(400, `A batch may contain at most ${MAX_TRPC_BATCH_SIZE} calls`);
  }
  if (request.method !== "GET" && batched > 1) {
    return reject(400, "Mutations cannot be batched");
  }

  return null;
}
