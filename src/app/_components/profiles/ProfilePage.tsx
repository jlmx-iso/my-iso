import {
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  SimpleGrid,
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
  IconPencil,
  IconUser,
  IconWorld,
} from "@tabler/icons-react";

import { FavoriteButton } from "./FavoriteButton";
import EditProfile from "./EditProfile";
import EmptyState from "../EmptyState";
import { Notification } from "../Notification";
import { PortfolioThumbnail, PortfolioUpload } from "../portfolio";
import ProfileAvatar from "./ProfileAvatar";

import { facebookUrl, instagramUrl, tikTokUrl, twitterUrl, vimeoUrl, youTubeUrl } from "~/_utils";
import { auth } from "~/auth";
import { api } from "~/trpc/server";

type ProfilePageProps = {
  userId: string;
  photographer?: Photographer;
  isEditing?: boolean;
  isSuccess?: boolean;
};

const socialLinks = [
  { key: "website" as const, icon: IconWorld, label: "Website", toUrl: (h: string) => h },
  { key: "instagram" as const, icon: IconBrandInstagram, label: "Instagram", toUrl: instagramUrl },
  { key: "facebook" as const, icon: IconBrandFacebook, label: "Facebook", toUrl: facebookUrl },
  { key: "twitter" as const, icon: IconBrandX, label: "X", toUrl: twitterUrl },
  { key: "youtube" as const, icon: IconBrandYoutube, label: "YouTube", toUrl: youTubeUrl },
  { key: "tiktok" as const, icon: IconBrandTiktok, label: "TikTok", toUrl: tikTokUrl },
  { key: "vimeo" as const, icon: IconBrandVimeo, label: "Vimeo", toUrl: vimeoUrl },
] as const;

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
          <Button component="a" href="/register" size="md">
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

  if (isEditingModeEnabled) {
    return <EditProfile photographer={photographer} />;
  }

  return (
    <Stack w="100%" gap="xl">
      {isSuccess && (
        <Notification type="success">
          Your profile has been updated successfully!
        </Notification>
      )}

      {/* Cover / Portfolio Banner */}
      {resources.length > 0 && (
        <Box
          h={{ base: 200, sm: 280 }}
          pos="relative"
          w="100%"
          style={{
            borderRadius: "var(--mantine-radius-lg)",
            overflow: "hidden",
          }}
        >
          {resources.slice(0, 1).map((image) => (
            <PortfolioThumbnail key={image.id} src={image.image} alt="" />
          ))}
          {/* Gradient overlay for depth */}
          <Box
            pos="absolute"
            bottom={0}
            left={0}
            right={0}
            h={80}
            style={{
              background:
                "linear-gradient(transparent, rgba(0,0,0,0.3))",
            }}
          />
        </Box>
      )}

      {/* Profile Header Card */}
      <Paper
        p={{ base: "lg", sm: "xl" }}
        radius="lg"
        withBorder
        style={{
          marginTop: resources.length > 0 ? -48 : 0,
          position: "relative",
          zIndex: 1,
        }}
      >
        <Group align="flex-start" wrap="nowrap" gap="lg">
          {/* Avatar */}
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

          {/* Name + Meta */}
          <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" wrap="nowrap">
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
          </Stack>

          {/* Actions */}
          <Group gap="xs">
            {!isSelf && (
              <FavoriteButton
                isFavorite={isFavorite}
                targetUserId={photographer.id}
              />
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
      </Paper>

      {/* Content Grid */}
      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
        {/* Left Column — Bio + Socials */}
        <Stack gap="lg" style={{ gridColumn: "span 1" }}>
          {/* Bio */}
          {photographer.bio && (
            <Paper p="lg" radius="md" withBorder>
              <Text
                size="xs"
                fw={700}
                c="dimmed"
                tt="uppercase"
                mb="sm"
                style={{ letterSpacing: 1 }}
              >
                About
              </Text>
              <Text size="sm" style={{ lineHeight: 1.7 }}>
                {photographer.bio}
              </Text>
            </Paper>
          )}

          {/* Social Links */}
          {activeSocials.length > 0 && (
            <Paper p="lg" radius="md" withBorder>
              <Text
                size="xs"
                fw={700}
                c="dimmed"
                tt="uppercase"
                mb="sm"
                style={{ letterSpacing: 1 }}
              >
                Connect
              </Text>
              <Stack gap="xs">
                {activeSocials.map((social) => {
                  const handle = photographer[social.key];
                  if (!handle) return null;
                  const href = social.toUrl(handle);
                  const Icon = social.icon;
                  return (
                    <Anchor
                      key={social.key}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      underline="never"
                      c="inherit"
                    >
                      <Group gap="sm">
                        <Icon size={18} color="var(--mantine-color-dimmed)" />
                        <Text size="sm">{social.label}</Text>
                      </Group>
                    </Anchor>
                  );
                })}
              </Stack>
            </Paper>
          )}
        </Stack>

        {/* Right Column — Portfolio */}
        <Box style={{ gridColumn: resources.length > 0 ? "span 2" : "span 1" }}>
          {resources.length > 0 ? (
            <Paper p="lg" radius="md" withBorder>
              <Group justify="space-between" mb="md">
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
              <SimpleGrid
                cols={{ base: 2, sm: 3 }}
                spacing="sm"
              >
                {resources.map((image) => (
                  <Box
                    key={image.id}
                    pos="relative"
                    style={{
                      aspectRatio: "1",
                      borderRadius: "var(--mantine-radius-md)",
                      overflow: "hidden",
                    }}
                  >
                    <PortfolioThumbnail src={image.image} alt={image.title} />
                  </Box>
                ))}
              </SimpleGrid>
            </Paper>
          ) : isSelf ? (
            <Paper
              p="xl"
              radius="md"
              withBorder
              style={{ borderStyle: "dashed" }}
            >
              <Stack align="center" gap="md" py="lg">
                <IconCamera
                  size={48}
                  color="var(--mantine-color-dimmed)"
                  stroke={1.5}
                />
                <Stack align="center" gap={4}>
                  <Text fw={600} size="sm">
                    No portfolio images yet
                  </Text>
                  <Text size="xs" c="dimmed" ta="center" maw={280}>
                    Upload photos to showcase your work and attract more clients.
                  </Text>
                </Stack>
                <PortfolioUpload />
              </Stack>
            </Paper>
          ) : null}
        </Box>
      </SimpleGrid>
    </Stack>
  );
};
