"use client";

import { Card, Group, Text } from "@mantine/core";
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
    const { mutate, isLoading } = api.event.addOrRemoveEventCommentLike.useMutation({
        onSuccess: async () => {
            const updatedComment = await refetch();
            if (updatedComment.data) {
                setComment(updatedComment.data);
            }
        }
    });
    const { user } = comment;

    return (
        <Card withBorder={false}>
            <Group justify="space-between" align="start" style={{ flexDirection: "row-reverse" }}>
                <Timemarker date={comment.createdAt} />
                <UserBadge user={{
                    avatar: user.profilePic,
                    name: user.firstName + " " + user.lastName,
                    userId: comment.userId
                }} />
            </Group>
            <Text>{comment.content}</Text>
            <LikeButton isLiked={comment.isLiked} mutate={mutate} targetType="comment" targetId={comment.id} isLoading={isLoading} numberOfLikes={comment.commentLikes} />
        </Card>
    );

}