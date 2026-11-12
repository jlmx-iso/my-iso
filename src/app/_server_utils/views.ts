import "server-only";

import { headers } from "next/headers";

import { SITE_URL } from "~/_lib/site";
import type { ViewSource } from "~/_utils/viewSources";
import { utcDay, viewSourceFromReferer, viewSourceToken, type ViewTarget } from "~/server/_lib/viewCounter";

/**
 * Where the visitor to this page came from, for the view count that the
 * page's ViewBeacon sends: a category from the Referer's path, compared
 * with the configured public origin only (never a forwarded host).
 */
export async function viewSource(): Promise<ViewSource> {
  return viewSourceFromReferer((await headers()).get("referer"), SITE_URL);
}

/** What a page passes to ViewBeacon: the target, its source, and the token that vouches for it. */
export type ViewBeaconProps = ViewTarget & { source: ViewSource; token: string };

/** ViewBeacon's props for `target`, from this page request. */
export async function viewBeaconProps(target: ViewTarget, now: Date = new Date()): Promise<ViewBeaconProps> {
  const source = await viewSource();
  return { ...target, source, token: await viewSourceToken(target, source, utcDay(now)) };
}
