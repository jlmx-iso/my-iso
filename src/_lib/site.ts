// Who and where this app is. The one place the public URL, the support
// address and the company behind the app are defined; safe to import from
// server and client code.

import { env } from "~/env";

/**
 * The app's public origin, without a trailing slash (NEXT_PUBLIC_BASE_URL).
 * Every absolute URL the app produces (metadata, sitemap, emails, redirects
 * to payment pages) is built from this.
 */
export const SITE_URL = env.NEXT_PUBLIC_BASE_URL.replace(/\/+$/, "");

/** Host shown to people, e.g. "myiso.app". */
export const SITE_HOST = new URL(SITE_URL).host;

/** Where people write for help (NEXT_PUBLIC_SUPPORT_EMAIL). */
export const SUPPORT_EMAIL = env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@myiso.app";

/** The legal entity that operates ISO. */
export const COMPANY = { name: "MyISO, LLC", url: "https://myiso.dev" } as const;

/** Absolute URL for a path on this site. */
export function siteUrl(path = "/"): string {
  return new URL(path, `${SITE_URL}/`).toString();
}
