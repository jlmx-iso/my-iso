import { Container, Stack, Group } from "@mantine/core";
import { type Photographer } from "@prisma/client";
import { getServerSession } from "next-auth";
import Image from "next/image";
import { type CSSProperties } from "react";
import { getPortfolioImages } from "~/app/_server_utils/";
import { authOptions } from "~/server/auth";
import { api } from "~/trpc/server";
import { SocialIconFacebook, SocialIconInstagram, SocialIconTiktok, SocialIconTwitter, SocialIconVimeo, SocialIconWebsite, SocialIconYoutube } from "../_components/icons/SocialLink";
import { FavoriteButton } from "../_components/profiles/FavoriteButton";
import { Heading } from "./Heading";
import { Avatar } from "./Avatar";
import { EditIcon } from "../_components/icons/Edit";
import EditProfile from "../_components/profiles/EditProfile";
import { Notification } from "../_components/Notification";

// ProfilePageProps should have either userId or photographer
type ProfilePageProps = {
  userId: string;
  photographer?: Photographer;
  isEditing?: boolean;
  isSuccess?: boolean;
};

export const ProfilePage = async ({ userId, photographer, isEditing, isSuccess }: ProfilePageProps) => {
  const session = await getServerSession(authOptions);
  if (!photographer) {
    photographer = await api.photographer.getByUserId.query({ userId }) ?? undefined;
  }
  if (!photographer || !session) {
    return null;
  };

  const currentUserId = session.user.id;
  const favorites = await api.user.getFavorites.query({ userId: currentUserId });
  const isFavorite = favorites.some(favorite => favorite.targetId === photographer.id);
  const isSelf = currentUserId === userId;
  const isEditingModeEnabled = (isEditing && isSelf);
  const resources = await getPortfolioImages(photographer.userId);

  return (
    <Stack className="w-full">
      {/* Hero Image */}
      <Container fluid h={360} pos="relative" className="w-full" >
        {resources.length ? resources.map(image => {
          // image should take full width of container, max height of 360px, and be centered
          const imageStyle: CSSProperties = {
            objectFit: "cover",
          };
          return <Image src={image.secure_url} key={image.public_id} alt="" fill={true} style={imageStyle} className="object-contain" />;
        }) : null}
      </Container>

      {isEditingModeEnabled ? <EditProfile photographer={photographer} /> : (
        <>
          <Group>
            <Avatar src={photographer.avatar} alt={photographer.name} />
            <Stack gap={0}>
              <Group>
                <Heading>{photographer.name}</Heading>
                {!isSelf && <FavoriteButton isFavorite={isFavorite} targetUserId={photographer.id} currentUserId={currentUserId} />
                }
              </Group>
              <Heading order={3}>{photographer.companyName}</Heading>
              <Heading order={4}>{photographer.location}</Heading>
            </Stack>
            {isSelf && <EditIcon href={{ query: { edit: true } }} />}
          </Group>

          <Heading>Bio</Heading>
          <p>{photographer.bio}</p>

          <Heading>Socials</Heading>
          <Group>
            {photographer.website && <SocialIconWebsite href={photographer.website} />}
            {photographer.facebook && <SocialIconFacebook href={photographer.facebook} />}
            {photographer.instagram && <SocialIconInstagram href={photographer.instagram} />}
            {photographer.twitter && <SocialIconTwitter href={photographer.twitter} />}
            {photographer.youtube && <SocialIconYoutube href={photographer.youtube} />}
            {photographer.tiktok && <SocialIconTiktok href={photographer.tiktok} />}
            {photographer.vimeo && <SocialIconVimeo href={photographer.vimeo} />}
          </Group>
          {
            isSuccess && (
              <Notification type="success">
                Your profile has been updated successfully!
              </Notification>
            )}
        </>
      )}
    </Stack>
  );
};