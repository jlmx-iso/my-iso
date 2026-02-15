"use client";
import { ActionIcon } from "@mantine/core";
import { IconBookmark, IconBookmarkFilled } from "@tabler/icons-react";
import { useState } from "react";

import { api } from "~/trpc/react";


type FavoriteButtonProps = {
  isFavorite: boolean;
  targetUserId: string;
};

export const FavoriteButton = ({ isFavorite, targetUserId }: FavoriteButtonProps) => {
  const [isExistingFavorite, setIsExistingFavorite] = useState(isFavorite);
  const removeFavorite = api.user.removeFavorite.useMutation({
    onSuccess: () => setIsExistingFavorite(false),
  });
  const addFavorite = api.user.addFavorite.useMutation({
    onSuccess: () => setIsExistingFavorite(true),
  });
  const handleClick = () => {
    if (isExistingFavorite) {
      removeFavorite.mutate({ photographerId: targetUserId });
    } else {
      addFavorite.mutate({ photographerId: targetUserId });
    }
  };
  return (
    <ActionIcon
      color="blue"
      loading={addFavorite.isPending || removeFavorite.isPending}
      loaderProps={{ type: "dots" }}
      onClick={handleClick}
      variant="subtle"
      radius="sm"
      size="xl"
      className="relative top-0 right-0"
    >
      {isExistingFavorite ?
        <IconBookmarkFilled size={24} aria-label="Remove bookmark" /> :
        <IconBookmark size={24} aria-label="Add bookmark" />
      }
    </ActionIcon>
  );
};