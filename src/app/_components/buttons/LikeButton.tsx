"use client";
import { Button } from "@mantine/core";
import { IconHeart, IconHeartFilled } from "@tabler/icons-react";

type LikeButtonProps = {
    /** What is being liked, for the accessible name: "comment by Sarah". */
    targetLabel: string;
    onToggle: () => void;
    isPending: boolean;
    numberOfLikes: number;
    isLiked: boolean;
};

/** Heart toggle with its like count. */
export default function LikeButton({ targetLabel, onToggle, isPending, numberOfLikes, isLiked }: LikeButtonProps) {
    return (
        <Button
            onClick={onToggle}
            loading={isPending}
            variant="subtle"
            color={isLiked ? "red" : "gray"}
            size="compact-sm"
            w="fit-content"
            aria-pressed={isLiked}
            aria-label={`Like ${targetLabel}, ${numberOfLikes} ${numberOfLikes === 1 ? "like" : "likes"}`}
            leftSection={isLiked ? <IconHeartFilled size={16} /> : <IconHeart size={16} />}
        >
            {numberOfLikes}
        </Button>
    );
}
