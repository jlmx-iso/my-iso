import { Container, Group, Stack } from "@mantine/core";
import { type Photographer } from "@prisma/client";
import Image from "next/image";
import { getServerSession } from "next-auth";
import React, { type CSSProperties } from "react";


import { FavoriteButton } from "./FavoriteButton";
import { Heading } from "../Heading";
import EditProfile from "./EditProfile";
import { EditIcon } from "../icons/Edit";
import { Notification } from "../Notification";
import ProfileAvatar from "./ProfileAvatar";
import { SocialIconFacebook, SocialIconInstagram, SocialIconTiktok, SocialIconTwitter, SocialIconVimeo, SocialIconWebsite, SocialIconYoutube } from "../icons/SocialLink";

import { getPortfolioImages } from "~/app/_server_utils/";
import { authOptions } from "~/server/auth";
import { api } from "~/trpc/server";

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
    photographer = await (await api()).photographer.getByUserId({ userId }) ?? undefined;
  }
  if (!photographer || !session) {
    return null;
  };

  const currentUserId = session.user.id;
  const favorites = await (await api()).user.getFavorites({ userId: currentUserId });
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
            <ProfileAvatar avatar={photographer.avatar} name={photographer.name} isSelf={isSelf} />
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