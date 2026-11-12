import type { Metadata } from "next";

import { Providers } from "~/app/app/providers";
import { auth } from "~/auth";
import { db } from "~/server/db";

type Props = {
  params: Promise<{ handle: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;

  const photographer = await db.photographer.findFirst({
    where: { user: { handle } },
  });

  if (!photographer) {
    return { title: "Photographer Not Found" };
  }

  const name = photographer.name || "Photographer";
  const company = photographer.companyName || "Photographer";
  const location = photographer.location ? ` in ${photographer.location}` : "";
  const title = `${name} — ${company}${location}`;
  const description = photographer.bio
    ? photographer.bio.slice(0, 160)
    : `${name} is a photographer on ISO. View their portfolio, reviews, and availability.`;

  const ogImageUrl = `https://myiso.app/api/og/photographer?handle=${encodeURIComponent(handle)}`;

  return {
    description,
    openGraph: {
      description,
      images: [
        {
          alt: `${name} on ISO`,
          height: 630,
          url: ogImageUrl,
          width: 1200,
        },
      ],
      title,
      type: "profile",
    },
    title,
    twitter: {
      card: "summary_large_image",
      description,
      images: [ogImageUrl],
      title,
    },
  };
}

export default async function PhotographerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The page asks whether the viewer is signed in (to offer the review form).
  const session = await auth();
  return <Providers params={{ session }}>{children}</Providers>;
}
