import { Button, Divider, Stack } from "@mantine/core";
import { type Photographer } from "@prisma/client";
import { IconExternalLink, IconPencil } from "@tabler/icons-react";

import { NextLink } from "~/app/_components/NextLink";
import { countProfileView } from "~/app/_server_utils/views";
import { auth } from "~/auth";
import { api } from "~/trpc/server";

import EditProfile from "./EditProfile";
import { FavoriteButton } from "./FavoriteButton";
import { MessageAction } from "./MessageAction";
import ProfileHeader from "./ProfileHeader";
import ReviewsSection from "./ReviewsSection";
import PortfolioSection from "../portfolio/PortfolioSection";

type ProfilePageProps = {
  /** `isPro` from the server, for the Pro badge. */
  photographer: Photographer & { isPro: boolean };
  /** Render the edit form instead of the profile (owner only). */
  isEditing?: boolean;
};

/** In-app profile: the viewer's own (with management controls) or another member's. */
export const ProfilePage = async ({ photographer, isEditing }: ProfilePageProps) => {
  const session = await auth();
  if (!session?.user) return null;

  const isSelf = session.user.id === photographer.userId;
  const caller = await api();
  if (isEditing && isSelf) {
    const me = await caller.user.getMe();
    return <EditProfile photographer={photographer} handle={me.handle} />;
  }
  // For the member's insights; the owner's own visits are not counted.
  if (!isSelf) {
    await countProfileView(photographer.userId, session.user.id, [`/app/photographer/${photographer.userId}`]);
  }

  const [images, favorite, owner] = await Promise.all([
    caller.photographer.getPortfolioImages({ photographerId: photographer.id }),
    isSelf ? Promise.resolve({ isFavorite: false }) : caller.user.isFavorite({ targetId: photographer.id }),
    isSelf ? caller.user.getMe() : Promise.resolve(null),
  ]);

  return (
    <Stack w="100%" gap="xl">
      <ProfileHeader
        photographer={photographer}
        coverImage={images[0]?.image}
        canChangePhoto={isSelf}
        actions={
          isSelf ? (
            <>
              {owner?.handle && (
                <Button
                  component={NextLink}
                  href={`/photographer/${owner.handle}`}
                  variant="default"
                  size="sm"
                  leftSection={<IconExternalLink size={16} />}
                >
                  Public page
                </Button>
              )}
              <Button
                component={NextLink}
                href="/app/profile?edit=true"
                variant="light"
                size="sm"
                leftSection={<IconPencil size={16} />}
              >
                Edit profile
              </Button>
            </>
          ) : (
            <>
              <FavoriteButton
                isFavorite={favorite.isFavorite}
                photographerId={photographer.id}
                photographerName={photographer.name}
              />
              <MessageAction userId={photographer.userId} />
            </>
          )
        }
      />

      <Divider />
      <PortfolioSection photographerId={photographer.id} initialImages={images} isOwner={isSelf} />

      <Divider />
      <ReviewsSection
        photographerId={photographer.id}
        photographerName={photographer.name}
        viewer={isSelf ? "owner" : "member"}
      />
    </Stack>
  );
};
