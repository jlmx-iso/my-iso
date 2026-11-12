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
import { IconAlertCircle, IconCircleCheck, IconStar, IconStarFilled } from "@tabler/icons-react";
import Link from "next/link";
import { useId } from "react";

import { fullName } from "~/_utils/names";
import { REVIEWS_PAGE_SIZE } from "~/_utils/pageSizes";
import { mergePages, partialCountNote } from "~/_utils/pagination";
import { trpcErrorCode, userFacingError } from "~/_utils/userError";
import LocalDate from "~/app/_components/LocalDate";
import { useFocusNewItems } from "~/app/_hooks/useFocusNewItems";
import { notify } from "~/app/_lib/notify";
import { api } from "~/trpc/react";

import { Avatar } from "../Avatar";
import { memberReviewView } from "./reviewGate";
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
      notify.success({
        message: `Your ${values.rating}-star review of ${photographerName} is on their profile.`,
        title: "Review posted",
      });
      form.reset();
      onSubmitted();
    } catch (error) {
      // Reviewed from another tab or device in the meantime: show that review
      // instead of the form. Anything else is reported by the alert below.
      if (trpcErrorCode(error) === "CONFLICT") onSubmitted();
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
          <div role="alert">
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
            // Mantine only previews a rating chosen with the arrow keys (it
            // commits on Space/Enter, and Enter submits the form). The radio's
            // own change event bubbles here, so arrow keys choose a rating too.
            onChange={(event) => {
              if (event.target instanceof HTMLInputElement && event.target.type === "radio") {
                form.setFieldValue("rating", Number(event.target.value));
              }
            }}
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
            placeholder="What was it like working together?"
            autosize
            minRows={3}
            maxRows={6}
            {...form.getInputProps("description")}
            description={
              form.values.description.length >= 1800
                ? `Optional. ${form.values.description.length}/2000 characters`
                : "Optional"
            }
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
  const reviews = api.review.getPageByPhotographerId.useInfiniteQuery(
    { limit: REVIEWS_PAGE_SIZE, photographerId },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );
  const rating = api.review.getAverageRating.useQuery({ photographerId });
  // Only a signed-in visitor who is not the owner can review here. The server
  // says whether a review would be accepted, so the form is never offered to
  // someone it would refuse.
  const myState = api.review.getMyReviewState.useQuery(
    { photographerId },
    { enabled: viewer === "member" },
  );
  const gate = viewer === "member" ? memberReviewView(myState, photographerName) : null;
  const loaded = mergePages(reviews.data?.pages);
  // The header shows the real total; the list says when it shows fewer.
  const reviewCount = Math.max(rating.data?.count ?? 0, loaded.length);
  const partialNote = reviews.hasNextPage
    ? partialCountNote(loaded.length, reviewCount, { one: "review", other: "reviews" })
    : null;

  const { expectMore, listRef } = useFocusNewItems(loaded.length);

  const refresh = () => {
    void utils.review.getPageByPhotographerId.invalidate({ photographerId });
    void utils.review.getAverageRating.invalidate({ photographerId });
    void utils.review.getMyReviewState.invalidate({ photographerId });
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
      ) : loaded.length === 0 ? (
        <Text c="dimmed" size="sm">
          {viewer === "owner"
            ? "You don't have any reviews yet. They'll appear here after photographers you've worked with leave one."
            : `No reviews yet. Worked with ${photographerName}? Be the first to leave one.`}
        </Text>
      ) : (
        <Stack ref={listRef} gap="sm" component="ul" m={0} p={0} style={{ listStyle: "none" }}>
          {loaded.map((review) => {
            const reviewer = fullName(review.user);
            return (
              <Paper key={review.id} component="li" p="md" radius="md" withBorder data-testid="review-item">
                <Group align="flex-start" gap="md" wrap="nowrap">
                  <Avatar src={review.user.profilePic} name={reviewer} alt="" size={40} />
                  <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                    <Group justify="space-between" align="center" gap="xs">
                      <Text size="sm" fw={600}>
                        {reviewer}
                      </Text>
                      <Text size="xs" c="dimmed">
                        <LocalDate date={review.createdAt} format="dateLong" />
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

      {reviews.hasNextPage && (
        <Stack gap={6} align="center">
          <Text size="sm" c="dimmed" role="status" data-testid="reviews-partial">
            {partialNote ?? `Showing the ${loaded.length} most recent reviews`}
          </Text>
          <Button
            variant="default"
            onClick={() => {
              expectMore();
              void reviews.fetchNextPage();
            }}
            loading={reviews.isFetchingNextPage}
          >
            Load more reviews
          </Button>
          {reviews.isFetchNextPageError && (
            <Text size="sm" c="red" role="alert">
              We couldn&apos;t load more reviews. Please try again.
            </Text>
          )}
        </Stack>
      )}

      {gate?.kind === "own" && (
        // One review per person: show theirs instead of a form that would be refused.
        <Paper p="md" radius="md" withBorder bg="gray.0" data-testid="own-review">
          <Stack gap={4}>
            <Group gap="xs">
              <IconCircleCheck size={18} color="var(--mantine-color-teal-7)" aria-hidden />
              <Text size="sm" fw={600}>
                You reviewed {photographerName} on <LocalDate date={gate.review.createdAt} format="dateLong" />
              </Text>
            </Group>
            <StarRating rating={gate.review.rating} size={14} />
            <Text size="sm" fw={600}>
              {gate.review.title}
            </Text>
            {gate.review.description && (
              <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                {gate.review.description}
              </Text>
            )}
            <Text size="xs" c="dimmed" mt={4}>
              Each member can leave one review per photographer.
            </Text>
          </Stack>
        </Paper>
      )}
      {gate?.kind === "form" && (
        <ReviewForm
          photographerId={photographerId}
          photographerName={photographerName}
          onSubmitted={refresh}
        />
      )}
      {gate?.kind === "error" && (
        // Mantine's Alert is role="alert": announced when it appears.
        <Alert color="red" icon={<IconAlertCircle size={16} />} data-testid="review-state-error">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">We could not check whether you can review this photographer.</Text>
            <Button size="xs" variant="default" loading={myState.isFetching} onClick={() => void myState.refetch()}>
              Try again
            </Button>
          </Stack>
        </Alert>
      )}
      {gate?.kind === "blocked" && (
        <Text size="sm" c="dimmed" data-testid="review-blocked">
          {gate.message}
        </Text>
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
