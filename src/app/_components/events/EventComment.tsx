"use client";

import { Box, Group, Stack, Text } from "@mantine/core";

import { userFacingError } from "~/_utils/userError";
import { notify } from "~/app/_lib/notify";
import { type RouterOutputs, api } from "~/trpc/react";

import LikeButton from "../buttons/LikeButton";
import Timemarker from "../Timemarker";
import UserBadge from "../UserBadge";

type EventCommentProps = {
    comment: RouterOutputs["event"]["getCommentsPage"]["items"][number];
};

export default function EventComment({ comment: initialComment }: EventCommentProps) {
    // The like count and state refresh from this query after a toggle.
    const { data: comment = initialComment, refetch } = api.event.getCommentById.useQuery(
        { id: initialComment.id },
        { initialData: initialComment },
    );
    const { mutate, isPending } = api.event.addOrRemoveEventCommentLike.useMutation({
        onError: (error) =>
            notify.error({
                message: userFacingError(error, "Please try again."),
                title: "Couldn't update your like",
            }),
        onSuccess: () => void refetch(),
    });
    const { user } = comment;
    const name = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "ISO member";

    return (
        <Box component="li" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-gray-2)", listStyle: "none" }}>
            <Group justify="space-between" align="center" mb={4} wrap="nowrap">
                <UserBadge user={{ avatar: user.profilePic, name, userId: comment.userId }} />
                <Timemarker date={comment.createdAt} />
            </Group>
            <Stack gap={4} pl={50}>
                <Text size="sm" style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{comment.content}</Text>
                <LikeButton
                    isLiked={comment.isLiked}
                    onToggle={() => mutate({ targetId: comment.id })}
                    targetLabel={`comment by ${name}`}
                    isPending={isPending}
                    numberOfLikes={comment.commentLikes}
                />
            </Stack>
        </Box>
    );
}
