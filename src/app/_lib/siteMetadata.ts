import type { Metadata } from "next";

import { SITE_URL } from "~/_lib/site";

export const SITE_NAME = "ISO";
export const SITE_DESCRIPTION =
  "ISO is the network where lead photographers find skilled second shooters for weddings, events, and sessions. Build your team and book more work.";

/**
 * Open Graph fields every page shares. Next.js replaces (does not merge) the
 * parent's `openGraph` when a page defines its own, so pages build theirs with
 * `pageMetadata` to keep the image, site name, type and locale.
 */
export const defaultOpenGraph = {
  images: [
    {
      alt: "ISO — The Photographer Network",
      height: 630,
      url: `${SITE_URL}/api/og?title=ISO&subtitle=The+Photographer+Network`,
      width: 1200,
    },
  ],
  locale: "en_US",
  siteName: SITE_NAME,
  type: "website",
} satisfies NonNullable<Metadata["openGraph"]>;

type PageMetadataInput = {
  title: string;
  description: string;
  /** Canonical path of the page, e.g. `/about`. */
  path: string;
  /** Open Graph title when it should differ from the page title. */
  socialTitle?: string;
  /** Overrides for the shared Open Graph defaults (e.g. a profile image). */
  openGraph?: Partial<typeof defaultOpenGraph> & { type?: "website" | "profile" };
};

/** Metadata for a public page: title, description, canonical and full Open Graph. */
export function pageMetadata({
  title,
  description,
  path,
  socialTitle,
  openGraph,
}: PageMetadataInput): Metadata {
  const ogTitle = socialTitle ?? `${title} | ${SITE_NAME}`;
  return {
    alternates: { canonical: path },
    description,
    openGraph: {
      ...defaultOpenGraph,
      ...openGraph,
      description,
      title: ogTitle,
      url: path,
    },
    title,
    twitter: {
      card: "summary_large_image",
      description,
      title: ogTitle,
    },
  };
}
