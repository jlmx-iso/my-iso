"use client";

import { Box, Group, Stack, Text } from "@mantine/core";
import { type Comment } from "@prisma/client";
import { useState } from "react";


import LikeButton from "../buttons/LikeButton";
import Timemarker from "../Timemarker";
import UserBadge from "../UserBadge";

import { api } from "~/trpc/react";



type EventCommentProps = {
    comment: Comment & {
        user: {
            firstName: string;
            lastName: string;
            profilePic: string | null;
        };
        commentLikes: number;
        isLiked: boolean
    };
};

export default function EventComment({ comment: initialComment }: EventCommentProps) {
    const [comment, setComment] = useState(initialComment);
    const { refetch } = api.event.getCommentById.useQuery({ id: initialComment.id })
    const { mutate, isPending } = api.event.addOrRemoveEventCommentLike.useMutation({
        onSuccess: async () => {
            const updatedComment = await refetch();
            if (updatedComment.data) {
                setComment(updatedComment.data);
            }
        }
    });
    const { user } = comment;

    return (
        <Box py="sm" style={{ borderBottom: "1px solid var(--mantine-color-gray-2)" }}>
            <Group justify="space-between" align="center" mb={4}>
                <UserBadge user={{
                    avatar: user.profilePic,
                    name: user.firstName + " " + user.lastName,
                    userId: comment.userId
                }} />
                <Timemarker date={comment.createdAt} />
            </Group>
            <Stack gap={4} pl={46}>
                <Text size="sm">{comment.content}</Text>
                <LikeButton isLiked={comment.isLiked} mutate={mutate} targetType="comment" targetId={comment.id} isPending={isPending} numberOfLikes={comment.commentLikes} />
            </Stack>
        </Box>
    );

}