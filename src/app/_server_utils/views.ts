import "server-only";

import { headers } from "next/headers";

import { SITE_URL } from "~/_lib/site";
import type { ViewSource } from "~/_utils/viewSources";
import {
  checkedViewSource,
  utcDay,
  viewerKey,
  viewSourceFromReferer,
  viewSourceToken,
  type ViewTarget,
} from "~/server/_lib/viewCounter";
import { getClientIp } from "~/server/_utils/clientIp";
import { db } from "~/server/db";

/**
 * Where the visitor to this page came from, for the view count that the
 * page's ViewBeacon sends: a category from the Referer's path, compared
 * with the configured public origin only (never a forwarded host). The
 * Referer is the browser's claim; see viewBeaconProps for what is checked.
 */
export async function viewSource(): Promise<ViewSource> {
  return viewSourceFromReferer((await headers()).get("referer"), SITE_URL);
}

/** What a page passes to ViewBeacon: the target, its source, and the token that vouches for it. */
export type ViewBeaconProps = ViewTarget & { source: ViewSource; token: string };

/**
 * ViewBeacon's props for `target`, from this page request. `ownerId` is
 * the profile's member or the event's owner; `viewerId` the signed-in
 * viewer, if any. A "messages" Referer is vouched for only when the two
 * share a thread (checkedViewSource); the token then pins the source to
 * this target, day and viewer (the member, or signed out the client
 * address as the view endpoint will see it), so it cannot be swapped after
 * the page is rendered or replayed by another account or network.
 */
export async function viewBeaconProps(
  target: ViewTarget,
  people: { viewerId: string | null; ownerId: string },
  now: Date = new Date(),
): Promise<ViewBeaconProps> {
  const source = await checkedViewSource(db, await viewSource(), people);
  const viewer = viewerKey(people.viewerId, getClientIp(await headers()));
  return { ...target, source, token: await viewSourceToken(target, source, utcDay(now), viewer) };
}
