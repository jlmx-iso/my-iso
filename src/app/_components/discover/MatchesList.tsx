"use client";

import { Alert, Badge, Button, Group, Paper, Skeleton, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconChevronRight, IconHeartHandshake } from "@tabler/icons-react";
import Link from "next/link";

import { businessName, fullName } from "~/_utils/names";
import EmptyState from "~/app/_components/EmptyState";
import { api } from "~/trpc/react";

import { Avatar } from "../Avatar";

function formatTimeLeft(expiresAt: Date | null, now: number): string | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - now;
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours >= 1) return `${hours}h left to message`;
  const minutes = Math.floor(diff / (1000 * 60));
  return `${minutes}m left to message`;
}

export default function MatchesList() {
  const { data: matches, isPending, isError, refetch, dataUpdatedAt } = api.discover.getMatches.useQuery({
    limit: 50,
    offset: 0,
  });

  if (isPending) {
    return (
      <Stack gap="sm" aria-busy="true" aria-label="Loading matches">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={82} radius="md" />
        ))}
      </Stack>
    );
  }

  if (isError) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={16} />} title="We couldn't load your matches">
        <Button variant="default" size="xs" mt="xs" onClick={() => void refetch()}>
          Try again
        </Button>
      </Alert>
    );
  }

  if (matches.length === 0) {
    return (
      <EmptyState
        icon={IconHeartHandshake}
        title="No matches yet"
        description="When you and another photographer both like each other on Discover, they appear here and you can message them."
        action={
          <Button component={Link} href="/app/discover">
            Go to Discover
          </Button>
        }
      />
    );
  }

  return (
    <Stack gap="sm" component="ul" m={0} p={0} style={{ listStyle: "none" }}>
      {matches.map((match) => {
        const other = match.otherUser;
        const photo = other.photographer;
        const displayName = fullName(other);
        const company = businessName(other, photo?.companyName);
        // Relative to when the list was fetched, so rendering stays pure.
        const timeLeft = formatTimeLeft(match.expiresAt, dataUpdatedAt);
        // A match normally has a thread; fall back to the profile if not.
        const href = match.messageThreadId
          ? `/app/messages/${match.messageThreadId}`
          : `/app/photographer/${other.id}`;

        return (
          <li key={match.id}>
            <Paper
              component={Link}
              href={href}
              className="card-interactive"
              p="md"
              radius="md"
              withBorder
              display="block"
            >
              <Group gap="md" wrap="nowrap">
                <Avatar src={photo?.avatar ?? other.profilePic} name={displayName} alt="" size={48} />

                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Group gap="xs" style={{ rowGap: 2 }}>
                    <Text fw={600} lineClamp={1}>{displayName}</Text>
                    {match.status === "matched" && timeLeft && (
                      <Badge size="sm" variant="light" color={timeLeft === "Expired" ? "red" : "orange"}>
                        {timeLeft}
                      </Badge>
                    )}
                    {match.status === "messaged" && (
                      <Badge size="sm" variant="light" color="green">
                        Messaged
                      </Badge>
                    )}
                  </Group>

                  {company && (
                    <Text size="sm" lineClamp={1}>{company}</Text>
                  )}
                  {match.aiSummary ? (
                    <Text size="sm" c="dimmed" lineClamp={2}>
                      {match.aiSummary}
                    </Text>
                  ) : photo?.location ? (
                    <Text size="sm" c="dimmed" lineClamp={1}>
                      {photo.location}
                    </Text>
                  ) : null}
                </Stack>

                <IconChevronRight size={20} color="var(--mantine-color-gray-6)" aria-hidden />
              </Group>
            </Paper>
          </li>
        );
      })}
    </Stack>
  );
}
