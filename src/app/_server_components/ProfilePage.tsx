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

// ProfilePageProps should have either userId or photographer
type ProfilePageProps = {
  userId: string;
  photographer?: Photographer;
};

export const ProfilePage = async ({ userId, photographer }: ProfilePageProps) => {
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
  const resources = await getPortfolioImages(photographer.userId);
  return (
    // hero image
    // bookmark icon
    // photographer name
    // photographer location
    // photographer bio

    // Details
    // photographer website
    // photographer social media
    // photographer profile image

    // Gear

    // Call to action

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

      <Group>
        <h1>{photographer.name}</h1>
        {!isSelf && <FavoriteButton isFavorite={isFavorite} targetUserId={photographer.id} currentUserId={currentUserId} />
        }
      </Group>
      <h2>{photographer.companyName}</h2>
      <h3>{photographer.location}</h3>

      <h2>Bio</h2>
      <p>{photographer.bio}</p>

      <h2>Socials</h2>
      <Group>
        {photographer.website && <SocialIconWebsite href={photographer.website} />}
        {photographer.facebook && <SocialIconFacebook href={photographer.facebook} />}
        {photographer.instagram && <SocialIconInstagram href={photographer.instagram} />}
        {photographer.twitter && <SocialIconTwitter href={photographer.twitter} />}
        {photographer.youtube && <SocialIconYoutube href={photographer.youtube} />}
        {photographer.tiktok && <SocialIconTiktok href={photographer.tiktok} />}
        {photographer.vimeo && <SocialIconVimeo href={photographer.vimeo} />}
      </Group>

    </Stack>
  );
};