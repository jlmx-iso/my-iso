import type { Instrumentation } from "next";

/** Nothing to start: PostHog clients are created per send (see below). */
export function register() {
  // Intentionally empty. Next.js requires the export for `onRequestError`.
}

/** `ph_<project token>_posthog`, the cookie posthog-js keeps its state in. */
function distinctIdFromCookie(cookieHeader: string | undefined): string | undefined {
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
 * Sent with the request path and route only. The request's cookies are read
 * here to find the visitor's PostHog id and consent, and are never sent.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // Loaded on demand so the middleware bundle, which also includes this
  // file, does not carry the server SDK.
  const { captureServerException } = await import("~/server/_lib/posthog");

  const cookie = request.headers.cookie;
  captureServerException(error, {
    distinctId: distinctIdFromCookie(Array.isArray(cookie) ? cookie.join("; ") : cookie),
    extra: {
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
    },
    path: request.path,
    source: "next",
  });
};
