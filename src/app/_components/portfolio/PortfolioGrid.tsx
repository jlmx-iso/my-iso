"use client";

import { Box, Stack, Text } from "@mantine/core";
import { IconPhoto } from "@tabler/icons-react";

import EmptyState from "../EmptyState";
import PortfolioImageCard from "./PortfolioImageCard";

type PortfolioImage = {
  id: string;
  image: string;
  title: string;
  description: string | null;
  tags: string;
  isFeatured: boolean;
};

type PortfolioGridProps = {
  images: PortfolioImage[];
  isOwner: boolean;
  onEdit?: (id: string) => void;
  onImageDeleted?: () => void;
  onImageClick?: (image: PortfolioImage) => void;
};

export default function PortfolioGrid({
  images,
  isOwner,
  onEdit,
  onImageDeleted,
  onImageClick,
}: PortfolioGridProps) {
  if (images.length === 0) {
    return (
      <EmptyState
        icon={IconPhoto}
        title="No portfolio images yet"
        description={isOwner ? "Upload your best work to showcase your photography." : "This photographer hasn't added portfolio images yet."}
      />
    );
  }

  // Sort featured images first
  const sortedImages = [...images].sort((a, b) => {
    if (a.isFeatured && !b.isFeatured) return -1;
    if (!a.isFeatured && b.isFeatured) return 1;
    return 0;
  });

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }}>
        Portfolio
      </Text>
      <Box
        style={{
          columnCount: 3,
          columnGap: "var(--mantine-spacing-md)",
        }}
        visibleFrom="sm"
      >
        {sortedImages.map((image) => (
          <PortfolioImageCard
            key={image.id}
            {...image}
            isOwner={isOwner}
            onEdit={onEdit}
            onDelete={onImageDeleted}
            onClick={onImageClick ? () => onImageClick(image) : undefined}
          />
        ))}
      </Box>
      {/* Mobile: single column */}
      <Box
        style={{
          columnCount: 2,
          columnGap: "var(--mantine-spacing-sm)",
        }}
        hiddenFrom="sm"
      >
        {sortedImages.map((image) => (
          <PortfolioImageCard
            key={image.id}
            {...image}
            isOwner={isOwner}
            onEdit={onEdit}
            onDelete={onImageDeleted}
            onClick={onImageClick ? () => onImageClick(image) : undefined}
          />
        ))}
      </Box>
    </Stack>
  );
}
