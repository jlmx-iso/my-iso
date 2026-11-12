import "server-only";

import { headers } from "next/headers";

import { SITE_URL } from "~/_lib/site";
import type { ViewSource } from "~/_utils/viewSources";
import { viewSourceFromReferer } from "~/server/_lib/viewCounter";

/**
 * Where the visitor to this page came from, for the view count that the
 * page's ViewBeacon sends: a category from the Referer's path, compared
 * with the configured public origin only (never a forwarded host).
 */
export async function viewSource(): Promise<ViewSource> {
  return viewSourceFromReferer((await headers()).get("referer"), SITE_URL);
}
