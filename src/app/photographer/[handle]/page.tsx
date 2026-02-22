"use client";

import { Container, Stack, Text } from "@mantine/core";
import { IconCamera } from "@tabler/icons-react";
import { useParams } from "next/navigation";

import EmptyState from "~/app/_components/EmptyState";
import { Loader } from "~/app/_components/Loader";
import PortfolioGrid from "~/app/_components/portfolio/PortfolioGrid";
import PublicProfileHero from "~/app/_components/profiles/PublicProfileHero";
import ReviewForm from "~/app/_components/profiles/ReviewForm";
import ReviewsList from "~/app/_components/profiles/ReviewsList";
import { api } from "~/trpc/react";

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

        {/* Review Form */}
        <ReviewForm
          photographerId={photographer.id}
          onSuccess={handleReviewSuccess}
        />
      </Stack>
    </Container>
  );
}
