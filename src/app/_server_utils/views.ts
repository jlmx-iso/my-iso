import "server-only";

import { headers } from "next/headers";

import { env } from "~/env";
import { runAfterResponse } from "~/server/_lib/background";
import { recordEventView, recordProfileView, type ViewRequest } from "~/server/_lib/viewCounter";
import { db } from "~/server/db";

/** Prefetches announce themselves: Next.js's router, and the browser's own. */
function isPrefetch(requestHeaders: Headers): boolean {
  return (
    requestHeaders.get("next-router-prefetch") === "1" ||
    requestHeaders.has("next-router-segment-prefetch") ||
    /prefetch/i.test(requestHeaders.get("sec-purpose") ?? requestHeaders.get("purpose") ?? "")
  );
}

/** This site's origin as the browser sees it (the configured scheme, the request's host). */
function ownOrigin(requestHeaders: Headers): string {
  const base = new URL(env.NEXT_PUBLIC_BASE_URL);
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  return host ? `${base.protocol}//${host}` : base.origin;
}

async function viewRequest(viewerId: string | null): Promise<ViewRequest & { ownOrigin: string }> {
  const requestHeaders = await headers();
  return {
    isPrefetch: isPrefetch(requestHeaders),
    ownOrigin: ownOrigin(requestHeaders),
    referer: requestHeaders.get("referer"),
    userAgent: requestHeaders.get("user-agent"),
    viewerId,
  };
}

/**
 * Counts a view of a profile page, after the response (it never delays or
 * fails the page). `pagePaths`: the paths this profile is shown at, so a
 * refresh of the page itself is not a new view.
 */
export async function countProfileView(profileUserId: string, viewerId: string | null, pagePaths: readonly string[]) {
  const request = await viewRequest(viewerId);
  runAfterResponse("count-profile-view", () => recordProfileView(db, { ...request, pagePaths, profileUserId }));
}

/** Counts a view of an event page, as countProfileView. */
export async function countEventView(eventId: string, ownerId: string, viewerId: string) {
  const request = await viewRequest(viewerId);
  runAfterResponse("count-event-view", () =>
    recordEventView(db, { ...request, eventId, ownerId, pagePath: `/app/events/${eventId}` }),
  );
}
