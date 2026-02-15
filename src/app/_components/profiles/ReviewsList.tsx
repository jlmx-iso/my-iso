"use client";

import {
  Avatar,
  Group,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import { IconMessageCircle } from "@tabler/icons-react";

import EmptyState from "../EmptyState";
import { StarRating } from "./PublicProfileHero";

type Review = {
  id: string;
  rating: number;
  title: string;
  description: string | null;
  createdAt: Date;
  user: {
    firstName: string;
    lastName: string;
    profilePic: string | null;
  };
};

type ReviewsListProps = {
  reviews: Review[];
  averageRating: number;
  reviewCount: number;
};

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function ReviewsList({
  reviews,
  averageRating,
  reviewCount,
}: ReviewsListProps) {
  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Text size="sm" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }}>
          Reviews
        </Text>
        {reviewCount > 0 && (
          <Group gap="xs">
            <StarRating rating={averageRating} size={14} />
            <Text size="sm" fw={500}>
              {averageRating} ({reviewCount})
            </Text>
          </Group>
        )}
      </Group>

      {reviews.length === 0 ? (
        <EmptyState
          icon={IconMessageCircle}
          title="No reviews yet"
          description="Be the first to leave a review for this photographer."
        />
      ) : (
        <Stack gap="sm">
          {reviews.map((review) => (
            <Paper key={review.id} p="md" radius="md" withBorder>
              <Group align="flex-start" gap="md">
                <Avatar
                  src={review.user.profilePic}
                  alt={`${review.user.firstName} ${review.user.lastName}`}
                  size={40}
                  radius="xl"
                  color="initials"
                  name={`${review.user.firstName} ${review.user.lastName}`}
                />
                <Stack gap={4} style={{ flex: 1 }}>
                  <Group justify="space-between" align="center">
                    <Text size="sm" fw={600}>
                      {review.user.firstName} {review.user.lastName}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {formatDate(review.createdAt)}
                    </Text>
                  </Group>
                  <StarRating rating={review.rating} size={14} />
                  <Text size="sm" fw={600} mt={4}>
                    {review.title}
                  </Text>
                  {review.description && (
                    <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                      {review.description}
                    </Text>
                  )}
                </Stack>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
