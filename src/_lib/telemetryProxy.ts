// First-party proxy for PostHog. The browser only ever talks to the app's
// own origin (TELEMETRY_PROXY_PATH); this forwards those requests to PostHog.
//
// Runs in the Worker entry (worker.ts) before the request reaches Next.js,
// and in a Next.js route when there is no Worker (`next dev`, `next start`).
// Only standard Fetch API types are used so both can share it.

import { TELEMETRY_PROXY_PATH } from "../telemetryConfig.js";

/** Largest request body forwarded (session replay batches are the biggest). */
export const MAX_TELEMETRY_BODY_BYTES = 8 * 1024 * 1024;

/** posthog-js sends events with POST and reads config/scripts with GET. */
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST"]);

/**
 * Request headers that must not reach PostHog: credentials for this app,
 * and hop/edge headers that describe the proxy rather than the visitor.
 * `Host` is not copied either: fetch sets it from the target URL.
 */
const STRIPPED_REQUEST_HEADERS = [
  "cookie",
  "host",
  "connection",
  "content-length",
  "forwarded",
  "proxy-authorization",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "x-csrf-token",
];

/** PostHog project, personal and secret tokens; nothing else is forwarded. */
const POSTHOG_BEARER = /^Bearer ph[csx]_[A-Za-z0-9_-]+$/;

export type TelemetryProxyOptions = {
  apiHost: string;
  assetsHost: string;
  /** The visitor's address as seen by the edge (CF-Connecting-IP). */
  clientIp: string | null;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  prefix?: string;
};

/** True when `pathname` belongs to the proxy. */
export function isTelemetryProxyPath(
  pathname: string,
  prefix: string = TELEMETRY_PROXY_PATH,
): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Maps a proxied URL to the PostHog URL it stands for: the SDK bundles and
 * remote config (`/static/`, `/array/`) live on the assets host, everything
 * else (capture, flags, replay) on the ingestion host. The query string is
 * kept. Returns null for a path outside the proxy.
 */
export function mapTelemetryUrl(
  url: URL,
  hosts: { apiHost: string; assetsHost: string },
  prefix: string = TELEMETRY_PROXY_PATH,
): { isAsset: boolean; target: URL } | null {
  if (!isTelemetryProxyPath(url.pathname, prefix)) return null;
  // Dot segments were resolved by the URL parser before we see the path, so
  // what follows the prefix cannot climb out of it. Collapsing leading
  // slashes keeps "//host" from being read as a different origin below.
  const rest = `/${url.pathname.slice(prefix.length).replace(/^\/+/, "")}`;
  const isAsset = rest.startsWith("/static/") || rest.startsWith("/array/");
  const target = new URL(rest + url.search, isAsset ? hosts.assetsHost : hosts.apiHost);
  return { isAsset, target };
}

/** The headers forwarded to PostHog for `request`. */
export function buildUpstreamHeaders(request: Request, clientIp: string | null): Headers {
  const headers = new Headers(request.headers);
  for (const name of STRIPPED_REQUEST_HEADERS) headers.delete(name);
  const names: string[] = [];
  headers.forEach((_value, name) => names.push(name));
  for (const name of names) {
    // Cloudflare's own request headers (cf-connecting-ip, cf-ray, ...).
    if (name.toLowerCase().startsWith("cf-")) headers.delete(name);
  }

  const authorization = headers.get("authorization");
  if (authorization !== null && !POSTHOG_BEARER.test(authorization)) {
    headers.delete("authorization");
  }

  // PostHog reads the visitor's address (for GeoIP) from X-Forwarded-For.
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  return headers;
}

function reject(status: number, message: string, extra?: Record<string, string>): Response {
  return new Response(message, {
    headers: { "Cache-Control": "no-store", ...extra },
    status,
  });
}

/**
 * Passes `body` through, failing the stream once more than `limit` bytes
 * have gone by. Used when the client did not declare a length.
 */
function capBodySize(
  body: ReadableStream<Uint8Array>,
  limit: number,
): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > limit) {
          controller.error(new Error("Telemetry request body too large"));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

/**
 * Forwards one proxied request to PostHog and returns its response.
 *
 * The body is streamed, not buffered. Cookies and this app's credentials
 * never leave: see buildUpstreamHeaders. Responses come back without
 * `Set-Cookie`, so PostHog cannot set cookies on the app's origin.
 */
export async function handleTelemetryProxy(
  request: Request,
  options: TelemetryProxyOptions,
): Promise<Response> {
  if (!ALLOWED_METHODS.has(request.method)) {
    return reject(405, "Method not allowed", { Allow: "GET, HEAD, POST" });
  }

  const mapped = mapTelemetryUrl(new URL(request.url), options, options.prefix);
  if (!mapped) return reject(404, "Not found");

  const requestBody = request.method === "POST" ? request.body : null;
  const declaredLength = request.headers.get("content-length");
  if (requestBody && declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isFinite(length) || length < 0) return reject(400, "Bad request");
    if (length > MAX_TELEMETRY_BODY_BYTES) return reject(413, "Payload too large");
  }

  // A declared length was checked above and the runtime enforces it; an
  // undeclared (chunked) one is counted as it streams.
  const body =
    requestBody && declaredLength === null
      ? capBodySize(requestBody, MAX_TELEMETRY_BODY_BYTES)
      : requestBody;

  const init: RequestInit & { duplex?: "half" } = {
    body,
    headers: buildUpstreamHeaders(request, options.clientIp),
    method: request.method,
    redirect: "manual",
  };
  // Node's fetch requires this for a streamed body; Workers ignore it.
  if (body) init.duplex = "half";

  let upstream: Response;
  try {
    upstream = await (options.fetch ?? fetch)(mapped.target.toString(), init);
  } catch {
    return reject(502, "Bad gateway");
  }

  const headers = new Headers(upstream.headers);
  headers.delete("set-cookie");
  // fetch has already decoded the body; the edge compresses again for the
  // client, so the upstream's encoding and length no longer describe it.
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(upstream.body, {
    headers,
    status: upstream.status,
    statusText: upstream.statusText,
  });
}
