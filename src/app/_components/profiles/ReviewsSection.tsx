"use client";

import {
  Alert,
  Anchor,
  Button,
  Group,
  Input,
  Paper,
  Rating,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconStar, IconStarFilled } from "@tabler/icons-react";
import Link from "next/link";
import { useId } from "react";

import { formatLocalDate } from "~/_lib/dayjs";
import { userFacingError } from "~/_utils/userError";
import { api } from "~/trpc/react";

import { Avatar } from "../Avatar";
import { StarRating } from "./StarRating";

/**
 * Who is looking at the profile:
 *  - `anonymous`: signed out; invited to sign in to review.
 *  - `owner`: sees the reviews, never the form.
 *  - `member`: a signed-in non-owner; can leave a review.
 */
export type ReviewViewer = "anonymous" | "owner" | "member";

type ReviewsSectionProps = {
  photographerId: string;
  photographerName: string;
  viewer: ReviewViewer;
  /** Where to send an anonymous visitor who wants to review (a /login URL). */
  signInHref?: string;
};

type FormValues = { description: string; rating: number; title: string };

function ReviewForm({
  photographerId,
  photographerName,
  onSubmitted,
}: {
  photographerId: string;
  photographerName: string;
  onSubmitted: () => void;
}) {
  const ratingLabelId = useId();
  const ratingErrorId = useId();
  const createReview = api.review.create.useMutation();

  const form = useForm<FormValues>({
    initialValues: { description: "", rating: 0, title: "" },
    validate: {
      description: (value) => (value.length > 2000 ? "Keep your review under 2000 characters" : null),
      rating: (value) => (value < 1 || value > 5 ? "Choose a rating from 1 to 5 stars" : null),
      title: (value) => (value.trim().length === 0 ? "Add a short title for your review" : null),
    },
  });

  const handleSubmit = form.onSubmit(async (values) => {
    try {
      await createReview.mutateAsync({
        description: values.description.trim() || undefined,
        photographerId,
        rating: values.rating,
        title: values.title.trim(),
      });
      notifications.show({ color: "teal", message: "Thanks for sharing your experience.", title: "Review posted" });
      form.reset();
      onSubmitted();
    } catch {
      // The inline alert below reports it; nothing else to do here.
    }
  });

  return (
    <Paper p="lg" radius="md" withBorder>
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          <Title order={3} size="h5">
            Review {photographerName}
          </Title>

          {/* Always rendered so screen readers announce errors as they appear. */}
          <div role="alert" aria-live="assertive">
            {createReview.isError && (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                {userFacingError(createReview.error, "We couldn't post your review. Please try again.")}
              </Alert>
            )}
          </div>

          <Input.Wrapper
            label="Rating"
            labelProps={{ id: ratingLabelId }}
            required
            error={form.errors.rating}
            errorProps={{ id: ratingErrorId }}
          >
            <Rating
              size="xl"
              mt={4}
              name="rating"
              aria-labelledby={ratingLabelId}
              aria-describedby={form.errors.rating ? ratingErrorId : undefined}
              value={form.values.rating}
              onChange={(rating) => form.setFieldValue("rating", rating)}
              getSymbolLabel={(value) => `${value} star${value === 1 ? "" : "s"}`}
              emptySymbol={<IconStar size={32} color="var(--mantine-color-gray-6)" />}
              fullSymbol={<IconStarFilled size={32} color="var(--mantine-color-tan-6)" />}
            />
          </Input.Wrapper>

          <TextInput
            label="Title"
            placeholder="Summarize your experience"
            required
            maxLength={200}
            {...form.getInputProps("title")}
          />

          <Textarea
            label="Your review"
            description="Optional"
            placeholder="What was it like working together?"
            autosize
            minRows={3}
            maxRows={6}
            {...form.getInputProps("description")}
          />

          <Group>
            <Button type="submit" loading={createReview.isPending}>
              Post review
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}

/** A photographer's reviews, plus the review form for signed-in non-owners. */
export default function ReviewsSection({
  photographerId,
  photographerName,
  viewer,
  signInHref,
}: ReviewsSectionProps) {
  const utils = api.useUtils();
  const reviews = api.review.getByPhotographerId.useQuery({ photographerId });
  const rating = api.review.getAverageRating.useQuery({ photographerId });
  const reviewCount = rating.data?.count ?? 0;

  const refresh = () => {
    void utils.review.getByPhotographerId.invalidate({ photographerId });
    void utils.review.getAverageRating.invalidate({ photographerId });
  };

  return (
    <Stack gap="md" component="section" aria-labelledby="reviews-heading">
      <Group justify="space-between" align="center">
        <Title order={2} size="h4" id="reviews-heading">
          Reviews
        </Title>
        {reviewCount > 0 && rating.data && (
          <Group gap="xs" wrap="nowrap">
            <StarRating rating={rating.data.average} size={16} />
            <Text size="sm" fw={600}>
              {rating.data.average}
            </Text>
            <Text size="sm" c="dimmed">
              ({reviewCount} {reviewCount === 1 ? "review" : "reviews"})
            </Text>
          </Group>
        )}
      </Group>

      {reviews.isPending ? (
        <Stack gap="sm" aria-busy="true" aria-label="Loading reviews">
          <Skeleton height={88} radius="md" />
          <Skeleton height={88} radius="md" />
        </Stack>
      ) : reviews.isError ? (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          We couldn&apos;t load reviews.{" "}
          <Anchor component="button" type="button" onClick={() => void reviews.refetch()} inherit>
            Try again
          </Anchor>
        </Alert>
      ) : reviews.data.length === 0 ? (
        <Text c="dimmed" size="sm">
          {viewer === "owner"
            ? "You don't have any reviews yet. They'll appear here after photographers you've worked with leave one."
            : `No reviews yet. Worked with ${photographerName}? Be the first to leave one.`}
        </Text>
      ) : (
        <Stack gap="sm" component="ul" m={0} p={0} style={{ listStyle: "none" }}>
          {reviews.data.map((review) => {
            const reviewer =
              `${review.user.firstName || ""} ${review.user.lastName || ""}`.trim() || "ISO member";
            return (
              <Paper key={review.id} component="li" p="md" radius="md" withBorder>
                <Group align="flex-start" gap="md" wrap="nowrap">
                  <Avatar src={review.user.profilePic} name={reviewer} alt="" size={40} />
                  <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                    <Group justify="space-between" align="center" gap="xs">
                      <Text size="sm" fw={600}>
                        {reviewer}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {formatLocalDate(review.createdAt, "MMMM D, YYYY")}
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
            );
          })}
        </Stack>
      )}

      {viewer === "member" && (
        <ReviewForm
          photographerId={photographerId}
          photographerName={photographerName}
          onSubmitted={refresh}
        />
      )}
      {viewer === "anonymous" && signInHref && (
        <Text size="sm">
          <Anchor component={Link} href={signInHref} fw={600} underline="always">
            Sign in
          </Anchor>{" "}
          to leave a review.
        </Text>
      )}
    </Stack>
  );
}
