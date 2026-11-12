// The visitor's country, handed from the Worker entry to everything behind
// it (the telemetry proxy and the Next.js app) as one request header.
// Runs in the Worker entry (worker.ts) and is type-checked via
// tsconfig.worker.json.
//
// Cloudflare puts the country on `request.cf.country`, which only the
// Worker entry sees; OpenNext does not pass `cf` to route code in a way
// both `next dev` and the Worker share. A header does: the app reads it
// with `headers()` like any other, and `next dev` simply has none.

import { COUNTRY_HEADER } from "../_lib/consent";

/** `request.cf` as far as this needs it; absent outside Cloudflare. */
type WithCountry = { cf?: { country?: unknown } | null };

/** The two-letter country Cloudflare placed the request in, if any. */
export function requestCountry(request: Request & WithCountry): string | null {
  const country = request.cf?.country;
  return typeof country === "string" && /^[A-Za-z0-9]{2}$/.test(country)
    ? country.toUpperCase()
    : null;
}

/**
 * `request` with COUNTRY_HEADER set to Cloudflare's country for it. A value
 * the client sent itself is always dropped, so the header can only ever
 * say what Cloudflare said: it decides whether analytics need an opt-in
 * (~/_lib/consent).
 */
export function withCountryHeader(request: Request, country: string | null): Request {
  const sent = request.headers.has(COUNTRY_HEADER);
  if (!sent && country === null) return request;

  const headers = new Headers(request.headers);
  headers.delete(COUNTRY_HEADER);
  if (country !== null) headers.set(COUNTRY_HEADER, country);
  return new Request(request, { headers });
}
