import type { Instrumentation } from "next";

import {
  consentCapabilities,
  consentRequiresOptIn,
  COUNTRY_HEADER,
  parseConsentCookie,
  resolveConsent,
} from "~/_lib/consent";

/** Nothing to start: PostHog clients are created per send (see below). */
export function register() {
  // Intentionally empty. Next.js requires the export for `onRequestError`.
}

function headerValue(value: string | string[] | undefined, separator: string): string | undefined {
  return Array.isArray(value) ? value.join(separator) : value;
}

/** Auth.js session cookie names: HTTPS deployments use the `__Secure-` one. */
const SESSION_COOKIE_NAMES = ["__Secure-authjs.session-token", "authjs.session-token"] as const;

/**
 * The signed-in user's id, from the Auth.js session cookie. The cookie is
 * an encrypted JWT: it is decrypted with `AUTH_SECRET` and only a valid,
 * unexpired session yields an id, so a visitor cannot attribute an error to
 * someone else by sending a made-up cookie. Anything else (no session, no
 * secret, a cookie that does not decrypt) is anonymous. Exported for tests.
 */
export async function sessionUserIdFromCookie(
  cookieHeader: string | undefined,
): Promise<string | undefined> {
  const secret = process.env.AUTH_SECRET;
  if (!cookieHeader || !secret) return undefined;

  const { getToken } = await import("next-auth/jwt");
  // Only the cookie header is handed over (getToken would also read an
  // Authorization header).
  const req = { headers: new Headers({ cookie: cookieHeader }) };
  for (const cookieName of SESSION_COOKIE_NAMES) {
    try {
      const token = await getToken({
        cookieName,
        req,
        secret,
        secureCookie: cookieName.startsWith("__Secure-"),
      });
      if (token && typeof token.id === "string" && token.id) return token.id;
    } catch {
      // Not a session this deployment issued.
    }
  }
  return undefined;
}

/**
 * Reports errors Next.js catches while rendering pages, running route
 * handlers and server actions to PostHog error tracking.
 *
 * Sent with the request path (no query string) and route only. The
 * request's cookies are read here to find the signed-in user (from the
 * authenticated session, never from a client-controlled cookie) and the
 * visitor's consent, and are never sent.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // Loaded on demand so the middleware bundle, which also includes this
  // file, does not carry the server SDK.
  const { captureServerException } = await import("~/server/_lib/posthog");

  const cookie = headerValue(request.headers.cookie, "; ");
  // `next/headers` is out of scope here, so consent is resolved from the
  // headers Next.js hands over. A visitor who has since refused analytics
  // (cookie or Global Privacy Control) is never attached to the error, even
  // with a valid session.
  const consent = resolveConsent({
    cookie: parseConsentCookie(cookie),
    globalPrivacyControl: headerValue(request.headers["sec-gpc"], ",")?.trim() === "1",
    optInRequired: consentRequiresOptIn(headerValue(request.headers[COUNTRY_HEADER], ",")),
  });

  const identified = consentCapabilities(consent).capture;
  captureServerException(
    error,
    {
      distinctId: identified ? await sessionUserIdFromCookie(cookie) : undefined,
      extra: {
        method: request.method,
        routePath: context.routePath,
        routeType: context.routeType,
      },
      // A refusal also keeps out what the path says about the visitor (a
      // conversation id, a handle): only the route pattern is sent.
      path: identified ? request.path : context.routePath,
      source: "next",
    },
    { consent },
  );
};
