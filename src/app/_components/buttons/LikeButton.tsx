"use client";
import { ActionIcon } from "@mantine/core";
import { IconHeart, IconHeartFilled } from "@tabler/icons-react";

type LikeButtonProps = {
    targetType: "event" | "comment";
    targetId: string;
    mutate: ({ targetId }: { targetId: string }) => void;
    isPending: boolean;
    numberOfLikes: number;
    isLiked: boolean;
};

export default function LikeButton({ targetId, mutate, isPending, numberOfLikes, isLiked }: LikeButtonProps) {
    const handleLike = () => {
        mutate({ targetId });
    };

    return (
        <ActionIcon onClick={handleLike} loading={isPending} variant="subtle" disabled={isPending}>
            {isLiked ? <IconHeartFilled /> : <IconHeart />} {numberOfLikes > 0 && numberOfLikes}
        </ActionIcon>
    );
}