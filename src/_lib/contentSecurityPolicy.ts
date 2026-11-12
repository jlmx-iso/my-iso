// The Content-Security-Policy, per request. The middleware (src/middleware.ts)
// calls `nextWithContentSecurityPolicy` for every page request: it makes a
// fresh nonce, hands it to Next.js (which adds it to the scripts it renders)
// and to the root layout (for the app's own inline scripts), and sets the
// policy on the response. docs/adr/0002-csp.md has the reasoning.

import { NextResponse } from "next/server";

import { type CspMode, contentSecurityPolicyHeader } from "~/securityHeaders.js";

/**
 * Request header that carries the nonce to server components (read with
 * `requestNonce`, src/_lib/requestNonce.ts). Set by the middleware on every page request, overwriting
 * anything the client sent.
 */
export const NONCE_HEADER = "x-nonce";

/**
 * Request header Next.js reads the nonce from (it parses `'nonce-…'` out of
 * the policy). Next.js looks at this name and the report-only one; this one
 * is used in both modes.
 */
const NEXT_POLICY_REQUEST_HEADER = "content-security-policy";

export type ContentSecurityPolicyOptions = {
  /** The app's public origin, for the WebSocket source. */
  baseUrl?: string;
  isDevelopment?: boolean;
  mode: CspMode;
};

/** A fresh nonce: 128 random bits, base64. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Puts the nonce and the policy on `requestHeaders` (for Next.js and the
 * layout) and returns the response header that carries the policy.
 */
export function applyContentSecurityPolicy(
  requestHeaders: Headers,
  options: ContentSecurityPolicyOptions,
  nonce: string = createNonce(),
): { key: string; value: string } {
  const header = contentSecurityPolicyHeader({ ...options, nonce });
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set(NEXT_POLICY_REQUEST_HEADER, header.value);
  return header;
}

/**
 * The middleware's answer for a page request: carry on to the page with the
 * nonce in the request headers, and the policy on the response.
 */
export function nextWithContentSecurityPolicy(
  request: Request,
  options: ContentSecurityPolicyOptions,
  nonce?: string,
): NextResponse {
  const requestHeaders = new Headers(request.headers);
  const header = applyContentSecurityPolicy(requestHeaders, options, nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header.key, header.value);
  return response;
}

