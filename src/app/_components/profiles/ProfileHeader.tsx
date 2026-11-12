import { Badge, Box, Group, Stack, Text, Title } from "@mantine/core";
import { IconCamera, IconMapPin } from "@tabler/icons-react";

import { ProBadge } from "../ProBadge";
import ProfileAvatar from "./ProfileAvatar";
import { SocialLinks } from "./SocialLinks";
import { PortfolioThumbnail } from "../portfolio/PortfolioThumbnail";

type ProfileHeaderProps = {
  photographer: {
    /** From the server (the member's subscription): shows the Pro badge. */
    isPro?: boolean;
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
  /** First portfolio image, used as the cover banner. */
  coverImage?: string | null;
  /** Shows the "change photo" control on the avatar. Needs a SessionProvider. */
  canChangePhoto?: boolean;
  /** Buttons for the viewer: message, save, edit, sign in. */
  actions?: React.ReactNode;
  /** A line under the social links (the owner's insights link). */
  footer?: React.ReactNode;
};

/** Cover banner, avatar, name, meta, bio and social links of a photographer. */
export default function ProfileHeader({ photographer, coverImage, canChangePhoto = false, actions, footer }: ProfileHeaderProps) {
  return (
    <Box>
      <Box
        h={{ base: 180, sm: 280 }}
        pos="relative"
        w="100%"
        style={{
          background: coverImage
            ? undefined
            : "var(--iso-banner)",
          borderRadius: "var(--mantine-radius-lg)",
          overflow: "hidden",
        }}
      >
        {/* Decorative: the same image is in the portfolio below with its title. */}
        {coverImage && <PortfolioThumbnail src={coverImage} alt="" priority />}
      </Box>

      {/* Overlaps the banner */}
      <Box px={{ base: "xs", sm: "xl" }} mt={-56} pos="relative" style={{ zIndex: 1 }}>
        <Box
          w="fit-content"
          style={{
            background: "var(--mantine-color-body)",
            border: "4px solid var(--mantine-color-body)",
            borderRadius: "50%",
            lineHeight: 0,
          }}
        >
          <ProfileAvatar
            avatar={photographer.avatar}
            name={photographer.name}
            isSelf={canChangePhoto}
            size={112}
          />
        </Box>

        <Stack gap={8} mt="sm">
          <Group justify="space-between" align="flex-start" gap="sm">
            {/* The name wraps rather than truncating beside the actions. */}
            <Group gap="xs" align="center" style={{ flex: "1 1 220px", minWidth: 0 }}>
              <Title order={1} size="h2" style={{ overflowWrap: "anywhere" }}>
                {photographer.name}
              </Title>
              {photographer.isPro && <ProBadge size="sm" />}
              {/* Neutral: the role is a label, the Pro badge (orange, crown) a status. */}
              <Badge variant="light" color="gray" size="sm" leftSection={<IconCamera size={12} aria-hidden />}>
                Photographer
              </Badge>
            </Group>
            {actions && (
              <Group gap="xs" wrap="nowrap" align="flex-start">
                {actions}
              </Group>
            )}
          </Group>

          <Group gap="md" style={{ rowGap: 4 }}>
            {photographer.companyName && (
              <Text size="sm" fw={500} c="dimmed">
                {photographer.companyName}
              </Text>
            )}
            {photographer.location && (
              <Group gap={4} wrap="nowrap">
                <IconMapPin size={14} color="var(--mantine-color-dimmed)" aria-hidden />
                <Text size="sm" c="dimmed">
                  <span className="sr-only">Based in </span>
                  {photographer.location}
                </Text>
              </Group>
            )}
          </Group>

          {photographer.bio && (
            <Text size="sm" style={{ lineHeight: 1.7, whiteSpace: "pre-line" }} mt={4} maw={640} data-replay-block>
              {photographer.bio}
            </Text>
          )}

          <SocialLinks photographer={photographer} name={photographer.name} />
          {footer}
        </Stack>
      </Box>
    </Box>
  );
}
