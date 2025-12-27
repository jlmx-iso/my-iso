"use client";
import { ActionIcon } from "@mantine/core";
import { IconBookmark, IconBookmarkFilled } from "@tabler/icons-react";
import { useState } from "react";

import { api } from "~/trpc/react";


type FavoriteButtonProps = {
  isFavorite: boolean;
  targetUserId: string;
  currentUserId: string;
};

export const FavoriteButton = ({ isFavorite, currentUserId, targetUserId }: FavoriteButtonProps) => {
  const [isExistingFavorite, setIsExistingFavorite] = useState(isFavorite);
  const removeFavorite = api.user.removeFavorite.useMutation();
  const addFavorite = api.user.addFavorite.useMutation();
  const handleClick = async () => {
    if (isExistingFavorite) {
      removeFavorite.mutate({ photographerId: targetUserId, userId: currentUserId });
      if (removeFavorite.error) {
        return;
      }
      setIsExistingFavorite(false);
      return;
    }
    addFavorite.mutate({ photographerId: targetUserId, userId: currentUserId });
    if (addFavorite.error) {
      return;
    }
    setIsExistingFavorite(true);
  }
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
      {
        isExistingFavorite ?
        <IconBookmarkFilled size={24} aria-label="Bookmark" /> :
        <IconBookmark size={24} aria-label="Bookmark" />
      }

    </ActionIcon>
  );
};