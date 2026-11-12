// The Content-Security-Policy nonce of the current request, for server
// components. Kept apart from contentSecurityPolicy.ts so the middleware
// bundle does not pull in next/headers.

import { headers } from "next/headers";

import { NONCE_HEADER } from "./contentSecurityPolicy";

/**
 * This request's nonce, for a server component's inline `<script>` (the
 * root layout). Reads only the header the middleware set; nothing else of
 * the request (cookies included) is passed on.
 */
export async function requestNonce(): Promise<string | undefined> {
  return (await headers()).get(NONCE_HEADER) ?? undefined;
}
