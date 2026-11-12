"use client";

import {
  Avatar,
  Badge,
  Center,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconHeartHandshake, IconMessageCircle } from "@tabler/icons-react";
import Link from "next/link";

import EmptyState from "~/app/_components/EmptyState";
import { api } from "~/trpc/react";

function formatTimeLeft(expiresAt: Date | null): string | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours >= 1) return `${hours}h left`;
  const minutes = Math.floor(diff / (1000 * 60));
  return `${minutes}m left`;
}

export default function MatchesList() {
  const { data: matches, isLoading } = api.discover.getMatches.useQuery({
    limit: 50,
    offset: 0,
  });

  if (isLoading) {
    return (
      <Center py={60}>
        <Loader color="orange" />
      </Center>
    );
  }

  if (!matches || matches.length === 0) {
    return (
      <EmptyState
        icon={IconHeartHandshake}
        title="No matches yet"
        description="Keep swiping to find your perfect photographer match!"
      />
    );
  }

  return (
    <Stack gap="sm">
      {matches.map((match) => {
        const other = match.otherUser;
        const photo = other.photographer;
        const normalizedCompanyName = photo?.companyName?.trim();
        const displayName = normalizedCompanyName || (`${other.firstName || ""} ${other.lastName || ""}`.trim() || "User");
        const avatar = photo?.avatar ?? other.profilePic;
        const timeLeft = formatTimeLeft(match.expiresAt);

        return (
          <UnstyledButton
            key={match.id}
            component={Link}
            href={match.messageThreadId ? `/app/messages/${match.messageThreadId}` : "#"}
          >
            <Paper
              p="md"
              radius="md"
              withBorder
              style={{
                transition: "box-shadow 150ms ease",
                "&:hover": { boxShadow: "0 4px 12px rgba(0,0,0,0.08)" },
              }}
            >
              <Group gap="md" wrap="nowrap">
                <Avatar src={avatar} size={48} radius="xl" color="orange">
                  {(other.firstName || "U")[0]}
                </Avatar>

                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Group gap="xs" wrap="nowrap">
                    <Text fw={600} lineClamp={1}>{displayName}</Text>
                    {match.status === "matched" && timeLeft && (
                      <Badge
                        size="xs"
                        variant="light"
                        color={timeLeft === "Expired" ? "red" : "orange"}
                      >
                        {timeLeft}
                      </Badge>
                    )}
                    {match.status === "messaged" && (
                      <Badge size="xs" variant="light" color="green">
                        Messaged
                      </Badge>
                    )}
                  </Group>

                  {match.aiSummary && (
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {match.aiSummary}
                    </Text>
                  )}

                  {!match.aiSummary && photo?.location && (
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {photo.location}
                    </Text>
                  )}
                </Stack>

                <IconMessageCircle
                  size={20}
                  color="var(--mantine-color-orange-5)"
                />
              </Group>
            </Paper>
          </UnstyledButton>
        );
      })}
    </Stack>
  );
}
