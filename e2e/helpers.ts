// Shared by the end-to-end specs. See docs/TESTING.md, "End-to-end".

import type { BrowserContext } from "@playwright/test";
import { encode } from "next-auth/jwt";

import { E2E_AUTH_SECRET, E2E_MEMBER, E2E_PORT } from "./config.mjs";

export const ORIGIN = `http://localhost:${E2E_PORT}`;
// On plain http Auth.js uses the unprefixed cookie name, which is also the
// salt of the encrypted token.
const SESSION_COOKIE = "authjs.session-token";

/**
 * Signs `context` in as the seeded member: the same encrypted JWT Auth.js
 * would set after a sign-in (this app uses the JWT session strategy).
 */
export async function signIn(context: BrowserContext) {
  const value = await encode({
    salt: SESSION_COOKIE,
    secret: E2E_AUTH_SECRET,
    token: {
      email: E2E_MEMBER.email,
      firstName: E2E_MEMBER.firstName,
      id: E2E_MEMBER.id,
      lastName: E2E_MEMBER.lastName,
      name: `${E2E_MEMBER.firstName} ${E2E_MEMBER.lastName}`,
      profilePic: null,
      sub: E2E_MEMBER.id,
    },
  });
  await context.addCookies([
    { httpOnly: true, name: SESSION_COOKIE, sameSite: "Lax", url: ORIGIN, value },
  ]);
}

/**
 * No real outbound calls. The browser may only talk to the Worker under
 * test: any other host is refused and recorded in `externalRequests`, which
 * the spec asserts is empty. The Worker's own outbound calls are kept away
 * the same way: the only one a test can trigger is Google Places
 * autocomplete (typing a location), so the browser's request for
 * suggestions is refused before it reaches the Worker, and the form falls
 * back to the typed text, as it does when Places is down. Everything else
 * the Worker could call is off by configuration (e2e/serve.mjs): no Resend,
 * Anthropic or Stripe calls are made by these pages, and PostHog points at a
 * closed local port.
 */
export async function isolate(context: BrowserContext, externalRequests: string[]) {
  await context.route(
    (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
    async (route) => {
      externalRequests.push(route.request().url());
      await route.abort("blockedbyclient");
    },
  );
  await context.route(/\/api\/trpc\/[^?]*google\.getAutocompleteLocations/, (route) =>
    route.abort("blockedbyclient"),
  );
}
