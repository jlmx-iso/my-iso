import type { Metadata } from "next";
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

  const title = `${photographer.name} — ${photographer.companyName || "Photographer"} in ${photographer.location || ""}`;
  const description = photographer.bio
    ? photographer.bio.slice(0, 160)
    : `${photographer.name} is a photographer on ISO. View their portfolio, reviews, and availability.`;

  const ogImageUrl = `https://myiso.app/api/og/photographer?handle=${encodeURIComponent(handle)}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "profile",
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `${photographer.name} on ISO`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default function PhotographerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
