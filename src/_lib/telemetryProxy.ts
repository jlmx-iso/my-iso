// First-party proxy for PostHog. The browser only ever talks to the app's
// own origin (TELEMETRY_PROXY_PATH); this forwards those requests to PostHog.
//
// Runs in the Worker entry (worker.ts) before the request reaches Next.js,
// and in a Next.js route when there is no Worker (`next dev`, `next start`).
// Only standard Fetch API types are used so both can share it.
//
// It is not a general gateway to PostHog. It forwards exactly the requests
// posthog-js makes with this app's configuration, strips every credential,
// and forwards nothing at all for a visitor who has refused analytics.

import { TELEMETRY_PROXY_PATH } from "../telemetryConfig.js";
import { consentCapabilities, consentFromHeaders } from "./consent";

/**
 * Largest event batch forwarded. posthog-js flushes its queue every few
 * seconds and compresses it; real batches are a few KiB. 1 MiB is also what
 * PostHog accepts for a single event.
 */
export const MAX_EVENT_BODY_BYTES = 1024 * 1024;

/**
 * Largest session-replay batch forwarded. The recorder flushes its buffer
 * at about 0.9 MiB before compression (posthog-js `lazy-recorder`), but one
 * full snapshot of a large page is sent whole and can be several times
 * that, so replay gets headroom that events do not need.
 */
export const MAX_REPLAY_BODY_BYTES = 4 * 1024 * 1024;

type Route = {
  /** Which PostHog host serves it. */
  host: "api" | "assets";
  /** Request body limit; 0 = the request has no body. */
  maxBodyBytes: number;
  methods: readonly string[];
  /** Matched against the path after the proxy prefix. */
  pattern: RegExp;
};

/**
 * Every path the browser SDK requests (posthog-js 1.447: `dist/module.js`
 * and `lazy-recorder.js`), and nothing else:
 *
 * - `/e/`, `/i/v0/e/`, `/batch/`: event capture (the endpoint name comes
 *   from remote config; all three are capture endpoints).
 * - `/s/`: session replay.
 * - `/static/<file>.js` and `/static/<version>/<file>.js`: lazily loaded
 *   parts of the SDK (exception autocapture, the recorder, ...).
 * - `/array/<token>/config.js` and `/config`: remote config.
 *
 * Deliberately absent: `/flags` and `/decide` (the browser uses no feature
 * flags; `advanced_disable_flags`), `/api/...` (PostHog's private API,
 * surveys included), logs and metrics, and anything else PostHog serves.
 */
const ROUTES: readonly Route[] = [
  {
    host: "api",
    maxBodyBytes: MAX_EVENT_BODY_BYTES,
    methods: ["POST"],
    pattern: /^\/(?:e|i\/v0\/e|batch)\/?$/,
  },
  { host: "api", maxBodyBytes: MAX_REPLAY_BODY_BYTES, methods: ["POST"], pattern: /^\/s\/?$/ },
  {
    host: "assets",
    maxBodyBytes: 0,
    methods: ["GET", "HEAD"],
    pattern: /^\/static\/(?:[\w.-]+\/)?[\w.-]+\.js$/,
  },
  {
    host: "assets",
    maxBodyBytes: 0,
    methods: ["GET", "HEAD"],
    pattern: /^\/array\/[\w-]+\/config(?:\.js)?$/,
  },
];

/**
 * Request headers that must not reach PostHog: credentials (PostHog's
 * browser endpoints take the project token in the body, never a header),
 * `Referer`, and hop/edge headers that describe the proxy rather than the
 * visitor. `Host` is not copied either: fetch sets it from the target URL.
 *
 * `Referer` is the full URL of the page the SDK runs on, query string
 * included (`/join?code=...`, `/join?...&email=...`): exactly what the
 * scrubber removes from the events themselves. PostHog reads the page and
 * referrer from the (scrubbed) event properties, not from this header.
 */
const STRIPPED_REQUEST_HEADERS = [
  "authorization",
  "cookie",
  "referer",
  "host",
  "connection",
  "content-length",
  "forwarded",
  "proxy-authorization",
  "sec-gpc",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "x-csrf-token",
];

/** Response headers that must not reach the browser from PostHog. */
const STRIPPED_RESPONSE_HEADERS = [
  "set-cookie",
  "location",
  // fetch has already decoded the body; the edge compresses again for the
  // client, so the upstream's encoding and length no longer describe it.
  "content-encoding",
  "content-length",
];

/** 304 Not Modified is not one of them: cached SDK files rely on it. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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
 * Maps a proxied URL to the PostHog URL it stands for, if it is one of the
 * allowed routes. The query string is kept. Returns null for anything else.
 */
export function mapTelemetryUrl(
  url: URL,
  hosts: { apiHost: string; assetsHost: string },
  prefix: string = TELEMETRY_PROXY_PATH,
): { route: Route; target: URL } | null {
  if (!isTelemetryProxyPath(url.pathname, prefix)) return null;
  // Dot segments were resolved by the URL parser before we see the path.
  const rest = url.pathname.slice(prefix.length);
  const route = ROUTES.find((candidate) => candidate.pattern.test(rest));
  if (!route) return null;

  const base = route.host === "assets" ? hosts.assetsHost : hosts.apiHost;
  return { route, target: new URL(rest + url.search, base) };
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
 * - A visitor who refused analytics (`Sec-GPC: 1`, or the consent cookie
 *   says "denied") gets an empty 204 and PostHog is not contacted: not for
 *   events, not for config, and their address is not forwarded.
 * - Only the routes in ROUTES exist; everything else is 404.
 * - The body is streamed, not buffered, up to the route's limit.
 * - Cookies and credentials never leave (buildUpstreamHeaders). Responses
 *   come back without `Set-Cookie`, and an upstream redirect is not passed
 *   on: PostHog cannot set cookies on, or redirect within, this origin.
 *
 * Not rate limited here: the app's limiter costs a database write per
 * check, which telemetry must not. docs/DEPLOYMENT.md has the Cloudflare
 * rate-limiting rule for this path.
 */
export async function handleTelemetryProxy(
  request: Request,
  options: TelemetryProxyOptions,
): Promise<Response> {
  const mapped = mapTelemetryUrl(new URL(request.url), options, options.prefix);
  if (!mapped) return reject(404, "Not found");
  const { route, target } = mapped;

  if (!route.methods.includes(request.method)) {
    return reject(405, "Method not allowed", { Allow: route.methods.join(", ") });
  }

  if (!consentCapabilities(consentFromHeaders(request.headers)).capture) {
    return new Response(null, { headers: { "Cache-Control": "no-store" }, status: 204 });
  }

  const requestBody = route.maxBodyBytes > 0 ? request.body : null;
  const declaredLength = request.headers.get("content-length");
  if (requestBody && declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isFinite(length) || length < 0) return reject(400, "Bad request");
    if (length > route.maxBodyBytes) return reject(413, "Payload too large");
  }

  // A declared length was checked above and the runtime enforces it; an
  // undeclared (chunked) one is counted as it streams.
  const body =
    requestBody && declaredLength === null
      ? capBodySize(requestBody, route.maxBodyBytes)
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
    upstream = await (options.fetch ?? fetch)(target.toString(), init);
  } catch {
    return reject(502, "Bad gateway");
  }

  // PostHog's endpoints do not redirect. If one ever does, the browser is
  // not sent wherever it points.
  if (REDIRECT_STATUSES.has(upstream.status)) return reject(502, "Bad gateway");

  const headers = new Headers(upstream.headers);
  for (const name of STRIPPED_RESPONSE_HEADERS) headers.delete(name);
  return new Response(upstream.body, {
    headers,
    status: upstream.status,
    statusText: upstream.statusText,
  });
}
