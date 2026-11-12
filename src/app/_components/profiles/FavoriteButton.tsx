"use client";
import { ActionIcon, Tooltip } from "@mantine/core";
import { IconBookmark, IconBookmarkFilled } from "@tabler/icons-react";
import { useState } from "react";

import { userFacingError } from "~/_utils/userError";
import { notify } from "~/app/_lib/notify";
import { api } from "~/trpc/react";

type FavoriteButtonProps = {
  isFavorite: boolean;
  /** The photographer being saved. */
  photographerId: string;
  photographerName: string;
};

/** Toggle button that saves a photographer to the viewer's favourites. */
export const FavoriteButton = ({ isFavorite, photographerId, photographerName }: FavoriteButtonProps) => {
  const [isSaved, setIsSaved] = useState(isFavorite);
  const onError = (error: unknown) =>
    notify.error({
      message: userFacingError(error, "Please try again."),
      title: "Couldn't update your saved photographers",
    });
  const removeFavorite = api.user.removeFavorite.useMutation({
    onError,
    onSuccess: () => setIsSaved(false),
  });
  const addFavorite = api.user.addFavorite.useMutation({
    onError,
    onSuccess: () => setIsSaved(true),
  });
  const label = isSaved ? `Remove ${photographerName} from saved` : `Save ${photographerName}`;

  return (
    <Tooltip label={isSaved ? "Saved" : "Save"}>
      <ActionIcon
        loading={addFavorite.isPending || removeFavorite.isPending}
        onClick={() =>
          (isSaved ? removeFavorite : addFavorite).mutate({ photographerId })
        }
        variant={isSaved ? "light" : "default"}
        size="lg"
        aria-label={label}
        aria-pressed={isSaved}
      >
        {isSaved ? <IconBookmarkFilled size={20} /> : <IconBookmark size={20} />}
      </ActionIcon>
    </Tooltip>
  );
};
