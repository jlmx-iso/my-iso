"use client";

import { Button, Container, Group, Stack, Text } from "@mantine/core";
import { IconCamera } from "@tabler/icons-react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";

import EmptyState from "~/app/_components/EmptyState";
import { Loader } from "~/app/_components/Loader";
import PortfolioGrid from "~/app/_components/portfolio/PortfolioGrid";
import PublicProfileHero from "~/app/_components/profiles/PublicProfileHero";
import ReviewForm from "~/app/_components/profiles/ReviewForm";
import ReviewsList from "~/app/_components/profiles/ReviewsList";
import { api } from "~/trpc/react";

/** Why the viewer cannot leave a review (review.getMyReviewState's `blocker`). */
const REVIEW_BLOCKER_MESSAGES = {
  already_reviewed: "You have already reviewed this photographer.",
  no_completed_booking: "Reviews open after you have completed a booking together.",
  self: null,
} as const;

export default function PhotographerProfilePage() {
  const params = useParams<{ handle: string }>();
  const handle = params.handle;

  const {
    data: photographer,
    isLoading: isLoadingPhotographer,
    error: photographerError,
  } = api.photographer.getByUsername.useQuery(
    { username: handle },
    { enabled: !!handle }
  );

  const {
    data: portfolioImages,
    isLoading: isLoadingPortfolio,
    refetch: refetchPortfolio,
  } = api.photographer.getPortfolioImages.useQuery(
    { photographerId: photographer?.id ?? "" },
    { enabled: !!photographer?.id }
  );

  const {
    data: reviews,
    isLoading: isLoadingReviews,
    refetch: refetchReviews,
  } = api.review.getByPhotographerId.useQuery(
    { photographerId: photographer?.id ?? "" },
    { enabled: !!photographer?.id }
  );

  const {
    data: ratingData,
    refetch: refetchRating,
  } = api.review.getAverageRating.useQuery(
    { photographerId: photographer?.id ?? "" },
    { enabled: !!photographer?.id }
  );

  // Signed-in viewers only: the procedure is protected, and visitors get no form.
  const isSignedIn = useSession().status === "authenticated";
  const {
    data: reviewState,
    isError: isReviewStateError,
    isFetching: isFetchingReviewState,
    refetch: refetchReviewState,
  } = api.review.getMyReviewState.useQuery(
    { photographerId: photographer?.id ?? "" },
    { enabled: isSignedIn && !!photographer?.id }
  );
  const reviewBlockerMessage = reviewState?.blocker
    ? REVIEW_BLOCKER_MESSAGES[reviewState.blocker]
    : null;

  const isLoading = isLoadingPhotographer || isLoadingPortfolio || isLoadingReviews;

  if (isLoading) {
    return (
      <Container size="lg" py="xl">
        <Loader />
      </Container>
    );
  }

  if (photographerError || !photographer) {
    return (
      <Container size="lg" py="xl">
        <EmptyState
          icon={IconCamera}
          title="Photographer not found"
          description="The photographer profile you're looking for doesn't exist or may have been removed."
        />
      </Container>
    );
  }

  const handleReviewSuccess = () => {
    void refetchReviews();
    void refetchRating();
    void refetchReviewState();
  };

  const handlePortfolioDeleted = () => {
    void refetchPortfolio();
  };

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        {/* Hero Section */}
        <PublicProfileHero
          photographer={photographer}
          averageRating={ratingData?.average ?? 0}
          reviewCount={ratingData?.count ?? 0}
        />

        {/* Portfolio Gallery */}
        <PortfolioGrid
          images={portfolioImages ?? []}
          isOwner={false}
          onImageDeleted={handlePortfolioDeleted}
        />

        {/* Reviews Section */}
        <ReviewsList
          reviews={reviews ?? []}
          averageRating={ratingData?.average ?? 0}
          reviewCount={ratingData?.count ?? 0}
        />

        {/* Review form: only for a signed-in viewer whose review would be accepted */}
        {isSignedIn && reviewState?.canReview && (
          <ReviewForm
            photographerId={photographer.id}
            onSuccess={handleReviewSuccess}
          />
        )}
        {isSignedIn && reviewBlockerMessage && (
          <Text size="sm" c="dimmed">
            {reviewBlockerMessage}
          </Text>
        )}
        {/* Eligibility could not be loaded: say so, instead of showing neither the form nor a reason */}
        {isSignedIn && isReviewStateError && !reviewState && (
          <Group gap="sm">
            <Text size="sm" c="red">
              We could not check whether you can review this photographer.
            </Text>
            <Button
              size="xs"
              variant="light"
              loading={isFetchingReviewState}
              onClick={() => void refetchReviewState()}
            >
              Try again
            </Button>
          </Group>
        )}
      </Stack>
    </Container>
  );
}
