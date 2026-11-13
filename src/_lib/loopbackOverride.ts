// Test-only overrides that point a third-party API at a stand-in on this
// machine (STRIPE_API_BASE_URL, GOOGLE_OAUTH_ISSUER_URL). The rules are the
// same for each: honoured only for a loopback address, and refused outright
// in a production deployment. docs/DEPLOYMENT.md, "Never set on a deployment".

/** Hosts an override may point at: this machine only. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Whether `value` is a URL on this machine. */
export function isLoopbackUrl(value: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

/**
 * Whether this is a production deployment, as far as the overrides are
 * concerned. `NODE_ENV` cannot answer that on its own for the Worker: every
 * OpenNext build is a production build, including the one `wrangler dev`
 * serves locally. So a deployment counts as production when ANY of these
 * holds:
 *
 * - the Stripe key is a live-mode key (`sk_live_`/`rk_live_`);
 * - the app's public origin (`NEXT_PUBLIC_BASE_URL`) is not this machine;
 * - `NODE_ENV` is "production" and the code is not running in the Worker
 *   runtime (a Node production server).
 */
export function isProductionDeployment(config: {
  baseUrl: string | undefined;
  isWorkerRuntime: boolean;
  nodeEnv: string | undefined;
  secretKey: string;
}): boolean {
  if (/^(sk|rk)_live_/.test(config.secretKey)) return true;
  if (!config.baseUrl || !isLoopbackUrl(config.baseUrl)) return true;
  return config.nodeEnv === "production" && !config.isWorkerRuntime;
}

/**
 * Reads the override `name` (its value `value`): null when unset, the URL
 * when it is allowed. Refusing means throwing, so that a deployment
 * configured this way fails loudly rather than quietly talking to the real
 * service or to a stand-in:
 *
 * - in a production deployment (isProductionDeployment), whatever it is;
 * - elsewhere, unless it is a URL on this machine, so a stray value can never
 *   send keys or member data to another one.
 */
export function parseLoopbackOverride(
  name: string,
  value: string | undefined,
  options: { production: boolean },
): URL | null {
  if (!value) return null;
  if (options.production) {
    throw new Error(`${name} must not be set in production`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`${name} may only point at localhost`);
  }
  return url;
}
