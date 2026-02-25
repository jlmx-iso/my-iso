"use client";

import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Image,
  Overlay,
  Text,
} from "@mantine/core";
import { useHover } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconCamera, IconEdit, IconStar, IconTrash } from "@tabler/icons-react";
import { useState } from "react";

import { api } from "~/trpc/react";

type PortfolioImageCardProps = {
  id: string;
  image: string;
  title: string;
  description: string | null;
  tags: string;
  isFeatured: boolean;
  isOwner: boolean;
  onEdit?: (id: string) => void;
  onDelete?: () => void;
  onClick?: () => void;
};

export default function PortfolioImageCard({
  id,
  image,
  title,
  tags,
  isFeatured,
  isOwner,
  onEdit,
  onDelete,
  onClick,
}: PortfolioImageCardProps) {
  const { hovered, ref } = useHover();
  const [isDeleting, setIsDeleting] = useState(false);
  const [broken, setBroken] = useState(false);
  const deleteMutation = api.photographer.deletePortfolioImage.useMutation();

  const parsedTags: string[] = (() => {
    try {
      return JSON.parse(tags) as string[];
    } catch {
      return [];
    }
  })();

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDeleting) return;
    setIsDeleting(true);

    try {
      await deleteMutation.mutateAsync({ id });
      notifications.show({
        title: "Image Deleted",
        message: "Portfolio image has been removed.",
        color: "green",
      });
      onDelete?.();
    } catch (error) {
      notifications.show({
        title: "Error",
        message: "Failed to delete image. Please try again.",
        color: "red",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(id);
  };

  return (
    <Box
      ref={ref}
      pos="relative"
      style={{
        borderRadius: "var(--mantine-radius-md)",
        overflow: "hidden",
        cursor: onClick ? "pointer" : "default",
        breakInside: "avoid",
        marginBottom: "var(--mantine-spacing-md)",
      }}
      onClick={onClick}
    >
      {broken ? (
        <Box
          style={{
            width: "100%",
            aspectRatio: "4/3",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--mantine-color-gray-1)",
            borderRadius: "var(--mantine-radius-md)",
          }}
        >
          <IconCamera size={32} color="var(--mantine-color-gray-4)" />
        </Box>
      ) : (
        <Image
          src={image}
          alt={title}
          radius="md"
          style={{ display: "block", width: "100%" }}
          onError={() => setBroken(true)}
        />
      )}

      {/* Hover overlay with title and actions */}
      {hovered && (
        <Overlay
          gradient="linear-gradient(0deg, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0) 50%)"
          zIndex={1}
        >
          <Box
            pos="absolute"
            bottom={0}
            left={0}
            right={0}
            p="md"
            style={{ zIndex: 2 }}
          >
            <Group justify="space-between" align="flex-end">
              <Box>
                <Group gap={6} mb={4}>
                  {isFeatured && (
                    <IconStar size={14} color="var(--mantine-color-yellow-4)" fill="var(--mantine-color-yellow-4)" />
                  )}
                  <Text size="sm" fw={600} c="white" lineClamp={1}>
                    {title}
                  </Text>
                </Group>
                {parsedTags.length > 0 && (
                  <Group gap={4}>
                    {parsedTags.slice(0, 3).map((tag) => (
                      <Badge
                        key={tag}
                        size="xs"
                        variant="light"
                        color="gray"
                        style={{ color: "white", borderColor: "rgba(255,255,255,0.3)" }}
                      >
                        {tag}
                      </Badge>
                    ))}
                  </Group>
                )}
              </Box>

              {isOwner && (
                <Group gap={4}>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="white"
                    onClick={handleEdit}
                    aria-label="Edit image"
                  >
                    <IconEdit size={14} />
                  </ActionIcon>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red"
                    onClick={handleDelete}
                    loading={isDeleting}
                    aria-label="Delete image"
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              )}
            </Group>
          </Box>
        </Overlay>
      )}
    </Box>
  );
}
