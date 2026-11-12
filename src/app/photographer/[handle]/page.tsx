import { Button, Container, Divider, Stack } from "@mantine/core";
import { IconMessage, IconPencil, IconUserPlus } from "@tabler/icons-react";
import { notFound } from "next/navigation";

import { NextLink } from "~/app/_components/NextLink";
import PortfolioSection from "~/app/_components/portfolio/PortfolioSection";
import { MessageAction } from "~/app/_components/profiles/MessageAction";
import ProfileHeader from "~/app/_components/profiles/ProfileHeader";
import ReviewsSection, { type ReviewViewer } from "~/app/_components/profiles/ReviewsSection";
import { countProfileView } from "~/app/_server_utils/views";
import { auth } from "~/auth";
import { api } from "~/trpc/server";

type PageProps = { params: Promise<{ handle: string }> };

/** Public, shareable profile. Signed-out visitors can browse and are invited to sign in to act. */
export default async function PhotographerProfilePage({ params }: PageProps) {
  const { handle } = await params;
  const caller = await api();
  const photographer = await caller.photographer.getByUsername({ username: handle });
  // A real 404 (status and all) rather than a 200 "not found" screen.
  if (!photographer) notFound();

  const [session, images] = await Promise.all([
    auth(),
    caller.photographer.getPortfolioImages({ photographerId: photographer.id }),
  ]);
  const viewerId = session?.user?.id;
  const viewer: ReviewViewer = !viewerId
    ? "anonymous"
    : viewerId === photographer.userId
      ? "owner"
      : "member";

  if (viewer !== "owner") {
    await countProfileView(photographer.userId, viewerId ?? null, [`/photographer/${handle}`]);
  }

  const messageHref = `/app/messages?new=${photographer.userId}`;
  const signInHref = (destination: string) => `/login?callbackUrl=${encodeURIComponent(destination)}`;

  return (
    <Container size="lg" py="md" px={0}>
      <Stack gap="xl">
        <ProfileHeader
          photographer={photographer}
          coverImage={images[0]?.image}
          actions={
            viewer === "owner" ? (
              <Button component={NextLink} href="/app/profile" variant="light" size="sm" leftSection={<IconPencil size={16} />}>
                Manage profile
              </Button>
            ) : viewer === "member" ? (
              <MessageAction userId={photographer.userId} />
            ) : (
              <>
                <Button component={NextLink} href={signInHref(messageHref)} size="sm" leftSection={<IconMessage size={16} />}>
                  Sign in to message
                </Button>
                <Button component={NextLink} href="/join" variant="default" size="sm" leftSection={<IconUserPlus size={16} />}>
                  Join ISO
                </Button>
              </>
            )
          }
        />

        <Divider />
        <PortfolioSection photographerId={photographer.id} initialImages={images} isOwner={false} />

        <Divider />
        <ReviewsSection
          photographerId={photographer.id}
          photographerName={photographer.name}
          viewer={viewer}
          signInHref={signInHref(`/app/photographer/${photographer.userId}`)}
        />
      </Stack>
    </Container>
  );
}
