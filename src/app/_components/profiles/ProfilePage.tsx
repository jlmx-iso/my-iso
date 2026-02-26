import {
  Anchor,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { type Photographer } from "@prisma/client";
import {
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandTiktok,
  IconBrandVimeo,
  IconBrandX,
  IconBrandYoutube,
  IconCamera,
  IconMapPin,
  IconMessage,
  IconPencil,
  IconUser,
  IconWorld,
} from "@tabler/icons-react";

import { FavoriteButton } from "./FavoriteButton";
import EditProfile from "./EditProfile";
import EmptyState from "../EmptyState";
import { Notification } from "../Notification";
import PortfolioImageCard from "../portfolio/PortfolioImageCard";
import { PortfolioThumbnail, PortfolioUpload } from "../portfolio";
import ProfileAvatar from "./ProfileAvatar";

import { facebookUrl, instagramUrl, tikTokUrl, toSafeWebsiteUrl, twitterUrl, vimeoUrl, youTubeUrl } from "~/_utils";
import { auth } from "~/auth";
import { api } from "~/trpc/server";

type ProfilePageProps = {
  userId: string;
  photographer?: Photographer;
  isEditing?: boolean;
  isSuccess?: boolean;
};

const socialLinks: Array<{
  key: "website" | "instagram" | "facebook" | "twitter" | "youtube" | "tiktok" | "vimeo";
  icon: React.ElementType;
  label: string;
  toUrl: (h: string) => string | null;
}> = [
  { icon: IconWorld, key: "website", label: "Website", toUrl: toSafeWebsiteUrl },
  { icon: IconBrandInstagram, key: "instagram", label: "Instagram", toUrl: instagramUrl },
  { icon: IconBrandFacebook, key: "facebook", label: "Facebook", toUrl: facebookUrl },
  { icon: IconBrandX, key: "twitter", label: "X", toUrl: twitterUrl },
  { icon: IconBrandYoutube, key: "youtube", label: "YouTube", toUrl: youTubeUrl },
  { icon: IconBrandTiktok, key: "tiktok", label: "TikTok", toUrl: tikTokUrl },
  { icon: IconBrandVimeo, key: "vimeo", label: "Vimeo", toUrl: vimeoUrl },
];

export const ProfilePage = async ({
  userId,
  photographer,
  isEditing,
  isSuccess,
}: ProfilePageProps) => {
  const session = await auth();
  if (!photographer) {
    photographer =
      (await (await api()).photographer.getByUserId({ userId })) ?? undefined;
  }

  if (!session) {
    return null;
  }

  if (!photographer) {
    return (
      <Stack gap="lg">
        <EmptyState
          icon={IconUser}
          title="No profile yet"
          description="Complete your registration to set up your photographer profile and start connecting."
        />
        <Group justify="center">
          <Button component="a" href="/join" size="md">
            Complete Registration
          </Button>
        </Group>
      </Stack>
    );
  }

  const currentUserId = session.user.id;
  const favorites = await (await api()).user.getFavorites();
  const isFavorite = favorites.some(
    (favorite) => favorite.targetId === photographer.id,
  );
  const isSelf = currentUserId === userId;
  const isEditingModeEnabled = isEditing && isSelf;
  const resources = await (await api()).photographer.getPortfolioImages({ photographerId: photographer.id });

  const activeSocials = socialLinks.filter(
    (s) => photographer[s.key],
  );

  const sortedResources = [...resources].sort((a, b) => {
    if (a.isFeatured && !b.isFeatured) return -1;
    if (!a.isFeatured && b.isFeatured) return 1;
    return 0;
  });

  if (isEditingModeEnabled) {
    return <EditProfile photographer={photographer} />;
  }

  return (
    <Stack w="100%" gap={0}>
      {isSuccess && (
        <Box mb="lg">
          <Notification type="success">
            Your profile has been updated successfully!
          </Notification>
        </Box>
      )}

      {/* Cover Banner */}
      <Box
        h={{ base: 200, sm: 300 }}
        pos="relative"
        w="100%"
        style={{
          borderRadius: "var(--mantine-radius-lg)",
          overflow: "hidden",
          background: resources.length === 0
            ? "linear-gradient(135deg, var(--mantine-color-orange-0) 0%, var(--mantine-color-teal-0) 40%, var(--mantine-color-purple-0) 100%)"
            : undefined,
        }}
      >
        {resources.length > 0 && (
          <>
            <PortfolioThumbnail src={resources[0]!.image} alt="" />
            <Box
              pos="absolute"
              bottom={0}
              left={0}
              right={0}
              h={120}
              style={{
                background:
                  "linear-gradient(transparent, rgba(0,0,0,0.45))",
              }}
            />
          </>
        )}
      </Box>

      {/* Profile Header — overlaps the banner */}
      <Box
        px={{ base: "md", sm: "xl" }}
        style={{ marginTop: -60, position: "relative", zIndex: 1 }}
      >
        <Box
          style={{
            background: "var(--mantine-color-body)",
            border: "3px solid var(--mantine-color-body)",
            borderRadius: "50%",
            lineHeight: 0,
            width: "fit-content",
          }}
        >
          <Box visibleFrom="sm">
            <ProfileAvatar
              avatar={photographer.avatar}
              name={photographer.name}
              isSelf={isSelf}
              size="xl"
            />
          </Box>
          <Box hiddenFrom="sm">
            <ProfileAvatar
              avatar={photographer.avatar}
              name={photographer.name}
              isSelf={isSelf}
              size="lg"
            />
          </Box>
        </Box>

        {/* Name + Meta + Bio */}
        <Stack gap={6} mt="md">
          <Group gap="xs" align="center" justify="space-between" wrap="nowrap">
            <Group gap="xs" align="center" style={{ minWidth: 0 }}>
              <Title order={2} lineClamp={1}>
                {photographer.name}
              </Title>
              <Badge variant="light" color="orange" size="sm">
                <Group gap={4}>
                  <IconCamera size={12} />
                  Photographer
                </Group>
              </Badge>
            </Group>

            <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
              {!isSelf && (
                <>
                  <FavoriteButton
                    isFavorite={isFavorite}
                    targetUserId={photographer.id}
                  />
                  <Button
                    component="a"
                    href={`/app/messages?new=${photographer.userId}`}
                    size="sm"
                    variant="filled"
                    leftSection={<IconMessage size={16} />}
                  >
                    Message
                  </Button>
                </>
              )}
              {isSelf && (
                <Button
                  component="a"
                  href="/app/profile?edit=true"
                  variant="light"
                  size="sm"
                  leftSection={<IconPencil size={16} />}
                >
                  Edit Profile
                </Button>
              )}
            </Group>
          </Group>

          <Group gap="md">
            {photographer.companyName && (
              <Text size="sm" fw={500} c="dimmed">
                {photographer.companyName}
              </Text>
            )}
            {photographer.location && (
              <Group gap={4}>
                <IconMapPin size={14} color="var(--mantine-color-dimmed)" />
                <Text size="sm" c="dimmed">
                  {photographer.location}
                </Text>
              </Group>
            )}
          </Group>

          {photographer.bio && (
            <Text size="sm" style={{ lineHeight: 1.7 }} mt={4} maw={640}>
              {photographer.bio}
            </Text>
          )}

          {activeSocials.length > 0 && (
            <Group gap="sm" mt={2}>
              {activeSocials.map((social) => {
                const handle = photographer[social.key];
                if (!handle) return null;
                const href = social.toUrl(handle);
                if (!href) return null;
                const Icon = social.icon;
                return (
                  <Anchor
                    key={social.key}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    c="dimmed"
                    style={{ display: "flex", alignItems: "center" }}
                    underline="never"
                    aria-label={social.label}
                  >
                    <Icon size={20} />
                  </Anchor>
                );
              })}
            </Group>
          )}
        </Stack>
      </Box>

      {/* Portfolio — only show section when there are images or it's the owner */}
      {(sortedResources.length > 0 || isSelf) && (
        <>
          <Divider my="xl" />

          <Box>
            {sortedResources.length > 0 && (
              <Group justify="space-between" mb="md" px={{ base: "md", sm: "xl" }}>
                <Text
                  size="xs"
                  fw={700}
                  c="dimmed"
                  tt="uppercase"
                  style={{ letterSpacing: 1 }}
                >
                  Portfolio
                </Text>
                {isSelf && <PortfolioUpload />}
              </Group>
            )}

            {sortedResources.length > 0 ? (
              <>
                <Box
                  style={{
                    columnCount: 3,
                    columnGap: "var(--mantine-spacing-sm)",
                  }}
                  px={{ base: "md", sm: "xl" }}
                  visibleFrom="sm"
                >
                  {sortedResources.map((image) => (
                    <PortfolioImageCard
                      key={image.id}
                      {...image}
                      isOwner={isSelf}
                    />
                  ))}
                </Box>
                <Box
                  style={{
                    columnCount: 2,
                    columnGap: "var(--mantine-spacing-xs)",
                  }}
                  px={{ base: "md", sm: "xl" }}
                  hiddenFrom="sm"
                >
                  {sortedResources.map((image) => (
                    <PortfolioImageCard
                      key={image.id}
                      {...image}
                      isOwner={isSelf}
                    />
                  ))}
                </Box>
              </>
            ) : (
              <Paper
                p="xl"
                mx={{ base: "md", sm: "xl" }}
                radius="md"
                withBorder
                style={{ borderStyle: "dashed" }}
              >
                <Stack align="center" gap="md" py="md">
                  <IconCamera
                    size={40}
                    color="var(--mantine-color-dimmed)"
                    stroke={1.5}
                  />
                  <Stack align="center" gap={4}>
                    <Text fw={600} size="sm">
                      Add your first portfolio image
                    </Text>
                    <Text size="xs" c="dimmed" ta="center" maw={280}>
                      Showcase your work to attract clients.
                    </Text>
                  </Stack>
                  <PortfolioUpload />
                </Stack>
              </Paper>
            )}
          </Box>
        </>
      )}
    </Stack>
  );
};
