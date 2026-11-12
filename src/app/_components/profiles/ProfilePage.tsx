import { Button, Divider, Stack } from "@mantine/core";
import { type Photographer } from "@prisma/client";
import { IconExternalLink, IconMessage, IconPencil } from "@tabler/icons-react";

import { NextLink } from "~/app/_components/NextLink";
import { auth } from "~/auth";
import { api } from "~/trpc/server";

import EditProfile from "./EditProfile";
import { FavoriteButton } from "./FavoriteButton";
import ProfileHeader from "./ProfileHeader";
import ReviewsSection from "./ReviewsSection";
import PortfolioSection from "../portfolio/PortfolioSection";

type ProfilePageProps = {
  photographer: Photographer;
  /** Render the edit form instead of the profile (owner only). */
  isEditing?: boolean;
};

/** In-app profile: the viewer's own (with management controls) or another member's. */
export const ProfilePage = async ({ photographer, isEditing }: ProfilePageProps) => {
  const session = await auth();
  if (!session?.user) return null;

  const isSelf = session.user.id === photographer.userId;
  if (isEditing && isSelf) {
    return <EditProfile photographer={photographer} />;
  }

  const caller = await api();
  const [images, favorites, owner] = await Promise.all([
    caller.photographer.getPortfolioImages({ photographerId: photographer.id }),
    isSelf ? Promise.resolve([]) : caller.user.getFavorites(),
    isSelf ? caller.user.getMe() : Promise.resolve(null),
  ]);
  const isFavorite = favorites.some((favorite) => favorite.targetId === photographer.id);

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
                isFavorite={isFavorite}
                photographerId={photographer.id}
                photographerName={photographer.name}
              />
              <Button
                component={NextLink}
                href={`/app/messages?new=${photographer.userId}`}
                size="sm"
                leftSection={<IconMessage size={16} />}
              >
                Message
              </Button>
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
