import type { Instrumentation } from "next";

import { consentCapabilities, parseConsentCookie, resolveConsent } from "~/_lib/consent";

/** Nothing to start: PostHog clients are created per send (see below). */
export function register() {
  // Intentionally empty. Next.js requires the export for `onRequestError`.
}

function headerValue(value: string | string[] | undefined, separator: string): string | undefined {
  return Array.isArray(value) ? value.join(separator) : value;
}

/**
 * The signed-in visitor's PostHog id, from `ph_<project token>_posthog`, the
 * cookie posthog-js keeps its state in. Exported for tests.
 */
export function distinctIdFromCookie(cookieHeader: string | undefined): string | undefined {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PUBLIC_KEY;
  if (!cookieHeader || !token) return undefined;

  const name = `ph_${token}_posthog=`;
  for (const part of cookieHeader.split(";")) {
    const cookie = part.trim();
    if (!cookie.startsWith(name)) continue;
    try {
      const state: unknown = JSON.parse(decodeURIComponent(cookie.slice(name.length)));
      if (typeof state !== "object" || state === null) return undefined;
      const { $user_state: userState, distinct_id: id } = state as Record<string, unknown>;
      // Only a signed-in visitor's id (the user id) ties the error to a
      // person; anonymous ids are left out.
      return userState === "identified" && typeof id === "string" ? id : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Reports errors Next.js catches while rendering pages, running route
 * handlers and server actions to PostHog error tracking.
 *
 * Sent with the request path (no query string) and route only. The
 * request's cookies are read here to find the visitor's PostHog id and
 * consent, and are never sent.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // Loaded on demand so the middleware bundle, which also includes this
  // file, does not carry the server SDK.
  const { captureServerException } = await import("~/server/_lib/posthog");

  const cookie = headerValue(request.headers.cookie, "; ");
  // `next/headers` is out of scope here, so consent is resolved from the
  // headers Next.js hands over. A visitor who has since refused analytics
  // (cookie or Global Privacy Control) is never attached to the error, even
  // if an old PostHog cookie still names them.
  const consent = resolveConsent({
    cookie: parseConsentCookie(cookie),
    globalPrivacyControl: headerValue(request.headers["sec-gpc"], ",")?.trim() === "1",
  });

  captureServerException(
    error,
    {
      distinctId: consentCapabilities(consent).capture ? distinctIdFromCookie(cookie) : undefined,
      extra: {
        method: request.method,
        routePath: context.routePath,
        routeType: context.routeType,
      },
      path: request.path,
      source: "next",
    },
    { consent },
  );
};
