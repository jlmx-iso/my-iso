"use client";

import {
  Anchor,
  Avatar,
  Box,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandTiktok,
  IconBrandTwitter,
  IconBrandVimeo,
  IconBrandYoutube,
  IconCalendarEvent,
  IconMapPin,
  IconMessage,
  IconWorld,
} from "@tabler/icons-react";
import Link from "next/link";
import { facebookUrl, instagramUrl, tikTokUrl, twitterUrl, vimeoUrl, youTubeUrl } from "~/_utils";

type Photographer = {
  id: string;
  name: string;
  companyName: string;
  location: string;
  bio: string | null;
  avatar: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  twitter: string | null;
  youtube: string | null;
  tiktok: string | null;
  vimeo: string | null;
};

type PublicProfileHeroProps = {
  photographer: Photographer;
  averageRating: number;
  reviewCount: number;
};

const SocialLink = ({ href, icon: Icon, label }: { href: string; icon: React.ElementType; label: string }) => (
  <Anchor
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    c="dimmed"
    style={{ display: "flex", alignItems: "center" }}
    underline="hover"
  >
    <Icon size={20} aria-label={label} />
  </Anchor>
);

function StarRating({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <Group gap={2}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = rating >= star;
        const halfFilled = !filled && rating >= star - 0.5;
        return (
          <svg
            key={star}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={filled ? "var(--mantine-color-yellow-5)" : halfFilled ? "url(#halfGrad)" : "none"}
            stroke={filled || halfFilled ? "var(--mantine-color-yellow-5)" : "var(--mantine-color-gray-4)"}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {halfFilled && (
              <defs>
                <linearGradient id="halfGrad">
                  <stop offset="50%" stopColor="var(--mantine-color-yellow-5)" />
                  <stop offset="50%" stopColor="transparent" />
                </linearGradient>
              </defs>
            )}
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        );
      })}
    </Group>
  );
}

export default function PublicProfileHero({
  photographer,
  averageRating,
  reviewCount,
}: PublicProfileHeroProps) {
  const hasSocials =
    photographer.website ||
    photographer.facebook ||
    photographer.instagram ||
    photographer.twitter ||
    photographer.youtube ||
    photographer.tiktok ||
    photographer.vimeo;

  return (
    <Paper p="xl" radius="md" withBorder>
      <Group align="flex-start" wrap="wrap" gap="xl">
        {/* Avatar */}
        <Avatar
          src={photographer.avatar}
          alt={photographer.name}
          size={120}
          radius="xl"
          color="initials"
          name={photographer.name}
        />

        {/* Info */}
        <Stack gap={4} style={{ flex: 1, minWidth: 200 }}>
          <Title order={2}>{photographer.name}</Title>

          {photographer.companyName && (
            <Text size="md" fw={500} c="dimmed">
              {photographer.companyName}
            </Text>
          )}

          <Group gap="xs" mt={2}>
            <IconMapPin size={16} color="var(--mantine-color-dimmed)" />
            <Text size="sm" c="dimmed">
              {photographer.location}
            </Text>
          </Group>

          {/* Rating */}
          {reviewCount > 0 && (
            <Group gap="xs" mt={4}>
              <StarRating rating={averageRating} />
              <Text size="sm" fw={500}>
                {averageRating}
              </Text>
              <Text size="sm" c="dimmed">
                ({reviewCount} {reviewCount === 1 ? "review" : "reviews"})
              </Text>
            </Group>
          )}

          {/* Social links */}
          {hasSocials && (
            <Group gap="sm" mt="xs">
              {photographer.website && (
                <SocialLink href={photographer.website} icon={IconWorld} label="Website" />
              )}
              {photographer.instagram && (
                <SocialLink href={instagramUrl(photographer.instagram)} icon={IconBrandInstagram} label="Instagram" />
              )}
              {photographer.facebook && (
                <SocialLink href={facebookUrl(photographer.facebook)} icon={IconBrandFacebook} label="Facebook" />
              )}
              {photographer.twitter && (
                <SocialLink href={twitterUrl(photographer.twitter)} icon={IconBrandTwitter} label="Twitter" />
              )}
              {photographer.youtube && (
                <SocialLink href={youTubeUrl(photographer.youtube)} icon={IconBrandYoutube} label="YouTube" />
              )}
              {photographer.tiktok && (
                <SocialLink href={tikTokUrl(photographer.tiktok)} icon={IconBrandTiktok} label="TikTok" />
              )}
              {photographer.vimeo && (
                <SocialLink href={vimeoUrl(photographer.vimeo)} icon={IconBrandVimeo} label="Vimeo" />
              )}
            </Group>
          )}
        </Stack>

        {/* CTAs */}
        <Stack gap="xs">
          <Button
            component={Link}
            href="/app/messages"
            leftSection={<IconMessage size={16} />}
            variant="filled"
          >
            Message
          </Button>
          <Button
            component={Link}
            href="/app/events"
            leftSection={<IconCalendarEvent size={16} />}
            variant="light"
          >
            View Events
          </Button>
        </Stack>
      </Group>

      {/* Bio */}
      {photographer.bio && (
        <Box mt="lg" pt="lg" style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}>
          <Text size="sm" fw={600} mb="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }}>
            About
          </Text>
          <Text size="sm" style={{ lineHeight: 1.7 }}>
            {photographer.bio}
          </Text>
        </Box>
      )}
    </Paper>
  );
}

export { StarRating };
