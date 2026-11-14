import Stripe from "stripe";

import { isProductionDeployment, parseLoopbackOverride } from "~/_lib/loopbackOverride";
import { env } from "~/env";
import { isCloudflareRuntime } from "~/server/_utils/clientIp";

// Shared with the other test-only overrides (~/_lib/loopbackOverride).
export { isProductionDeployment };

/**
 * The Stripe API version every request from this app is made with, and the
 * version the webhook payloads are parsed as.
 *
 * IMPORTANT: the webhook endpoint in the Stripe dashboard (Developers →
 * Webhooks → the endpoint → "API version") must be set to this same version.
 * Stripe renders each event with the ENDPOINT's version, not the request's:
 * an endpoint left on an older version sends, for example,
 * `subscription.current_period_end` and `invoice.subscription`, which no
 * longer exist in this version (they are `items.data[].current_period_end`
 * and `invoice.parent.subscription_details.subscription`).
 *
 * When upgrading the `stripe` package: read its changelog for the objects
 * used in ./subscriptionState.ts and ./webhook.ts, change this constant, and
 * change the endpoint's version in the dashboard in the same release.
 */
export const STRIPE_API_VERSION = "2026-10-28.endive" satisfies Stripe.LatestApiVersion;

type HostOverride = { host: string; port: string; protocol: "http" | "https" };

/**
 * `STRIPE_API_BASE_URL` sends API calls to a local stand-in for Stripe
 * (stripe-mock, or a stub server in an end-to-end run). TEST ONLY:
 *
 * - it is refused outright in a production deployment
 *   (isProductionDeployment), whatever it points at;
 * - elsewhere it is honoured only for loopback addresses, so a stray value
 *   can never send keys or customer data to another machine.
 *
 * Refusing means throwing: a deployment configured this way must fail
 * loudly rather than quietly talk to the real API or to a stand-in.
 */
export function parseStripeApiBaseUrl(
  value: string | undefined,
  options: { production: boolean } = { production: false },
): HostOverride | null {
  const url = parseLoopbackOverride("STRIPE_API_BASE_URL", value, options);
  if (!url) return null;
  const protocol = url.protocol === "https:" ? "https" : "http";
  return {
    host: url.hostname,
    port: url.port || (protocol === "https" ? "443" : "80"),
    protocol,
  };
}

/**
 * Builds a Stripe client. `fetch` is the HTTP client so that the same code
 * runs on Cloudflare Workers (no Node `http`) and on Node.
 */
export function createStripeClient(
  secretKey: string,
  override: HostOverride | null = null,
  options: { maxNetworkRetries?: number; timeoutMs?: number } = {},
): Stripe {
  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: { name: "my-iso" },
    httpClient: Stripe.createFetchHttpClient(),
    // Retried requests carry the same idempotency key (the SDK adds one to
    // every POST), so a retry can never create a second object.
    maxNetworkRetries: options.maxNetworkRetries ?? 2,
    // A Worker request must not hang on Stripe.
    timeout: options.timeoutMs ?? 15_000,
    ...(override ?? {}),
  });
}

let client: Stripe | null = null;

/**
 * The shared Stripe client, created on first use: at module load there are
 * no secrets yet on Workers, and most requests never talk to Stripe.
 *
 * Tests do not replace this client from outside: they mock this module's
 * `getStripe`, or pass a client to the functions in _billing directly.
 */
export function getStripe(): Stripe {
  client ??= createStripeClient(
    env.STRIPE_SECRET_KEY,
    parseStripeApiBaseUrl(env.STRIPE_API_BASE_URL, {
      production: isProductionDeployment({
        appEnv: env.APP_ENV,
        baseUrl: env.NEXT_PUBLIC_BASE_URL,
        isWorkerRuntime: isCloudflareRuntime(),
        nodeEnv: env.NODE_ENV,
        secretKey: env.STRIPE_SECRET_KEY,
      }),
    }),
  );
  return client;
}

let accessCheckClient: Stripe | null = null;

/**
 * A Stripe client for work done inside someone's request with a small time
 * budget (the lazy first sync of a subscription row, ./lazySync.ts): each
 * call gives up after three seconds and is not retried. The limit is per
 * call, not for the sync: work handed to `waitUntil` usually finishes well
 * inside the 30 seconds Workers allow, but is not guaranteed to. What
 * makes a cut-off harmless is in ./lazySync.ts, not here.
 */
export function getAccessCheckStripe(): Stripe {
  accessCheckClient ??= createStripeClient(
    env.STRIPE_SECRET_KEY,
    parseStripeApiBaseUrl(env.STRIPE_API_BASE_URL, {
      production: isProductionDeployment({
        appEnv: env.APP_ENV,
        baseUrl: env.NEXT_PUBLIC_BASE_URL,
        isWorkerRuntime: isCloudflareRuntime(),
        nodeEnv: env.NODE_ENV,
        secretKey: env.STRIPE_SECRET_KEY,
      }),
    }),
    { maxNetworkRetries: 0, timeoutMs: 3000 },
  );
  return accessCheckClient;
}

/** Whether a webhook signing secret is configured at all. */
export function isWebhookSecretConfigured(secret: string | undefined = env.STRIPE_WEBHOOK_SECRET): boolean {
  return typeof secret === "string" && secret.trim().length > 0;
}

/** Web Crypto HMAC: works on Workers, where Node's sync crypto is not used. */
const webhookCryptoProvider = Stripe.createSubtleCryptoProvider();

/**
 * Verifies a webhook's signature against the RAW request body and returns
 * the event. Throws `Stripe.errors.StripeSignatureVerificationError` for a
 * missing/forged signature or a timestamp outside Stripe's default tolerance
 * (five minutes; a replayed old delivery is refused).
 *
 * Static on the class: needs no API key and makes no request.
 */
export function constructWebhookEvent(
  rawBody: string,
  signatureHeader: string,
  secret: string = env.STRIPE_WEBHOOK_SECRET,
): Promise<Stripe.Event> {
  return Stripe.webhooks.constructEventAsync(
    rawBody,
    signatureHeader,
    secret,
    undefined,
    webhookCryptoProvider,
  );
}

/**
 * True for Stripe's "no such object" answer (HTTP 404, `resource_missing`).
 * With `param`, only when the missing object is the one that parameter
 * named (for example "customer").
 */
export function isStripeResourceMissing(error: unknown, param?: string): boolean {
  if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) return false;
  if (error.code !== "resource_missing" && error.statusCode !== 404) return false;
  return param === undefined || error.param === param;
}

/**
 * A response header by (lower-case) name. With the fetch HTTP client the
 * SDK's `lastResponse` is the fetch `Response` itself, whose `headers` is a
 * `Headers` object; with the Node client it is a plain object, which is what
 * the SDK's types describe. Both are handled.
 */
function responseHeader(headers: unknown, name: string): string | null {
  if (typeof headers !== "object" || headers === null) return null;
  if (headers instanceof Headers) return headers.get(name);
  const value: unknown = Reflect.get(headers, name);
  return typeof value === "string" ? value : null;
}

/**
 * The time on Stripe's clock at which a response was produced (its `Date`
 * header, one-second resolution), or `fallback` when the header is missing
 * or unreadable.
 */
export function stripeResponseTime(
  response: { lastResponse?: { headers?: unknown } },
  fallback: Date,
): Date {
  const header = responseHeader(response.lastResponse?.headers, "date");
  if (header === null) return fallback;
  const parsed = new Date(header);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}
