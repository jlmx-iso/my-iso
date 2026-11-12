"use client";

import { Button, Group, Text, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { getHotkeyHandler } from '@mantine/hooks';

import { MAX_COMMENT_LENGTH } from "~/_utils/limits";
import { userFacingError } from "~/_utils/userError";
import { api } from "~/trpc/react";

type AddCommentFormProps = {
    eventId: string;
    eventTitle: string;
    /** Called once the server has stored a comment. */
    onPosted?: () => void;
};

/** The counter appears once a comment is this close to the limit. */
const COUNTER_FROM = MAX_COMMENT_LENGTH - 200;

export default function AddCommentForm({ eventId, eventTitle, onPosted }: AddCommentFormProps) {
    const utils = api.useUtils();
    const form = useForm({
        initialValues: {
            comment: "",
        },
        validate: {
            comment: (value: string) => {
                if (!value.trim()) return "Write a comment first";
                const over = value.trim().length - MAX_COMMENT_LENGTH;
                return over > 0
                    ? `That comment is ${over} characters over the ${MAX_COMMENT_LENGTH.toLocaleString("en-US")} limit. Shorten it to post.`
                    : null;
            },
        },
    });
    const { mutate, isPending } = api.event.addCommentToEvent.useMutation({
        // The draft is only cleared once the server has stored the comment,
        // so a failed post (rate limit, too long, offline) loses nothing.
        onError: (error) =>
            form.setFieldError("comment", userFacingError(error, "Your comment wasn't posted. It's still here — please try again.")),
        onSuccess: () => {
            form.reset();
            onPosted?.();
            void utils.event.getCommentsPage.invalidate({ eventId });
            void utils.event.getCommentCountByEventId.invalidate({ eventId });
            void utils.event.getById.invalidate({ id: eventId });
        },
    });

    const handleSubmit = form.onSubmit((values) => {
        if (isPending) return;
        mutate({ content: values.comment.trim(), eventId });
    });

    const length = form.values.comment.trim().length;

    return (
        <form onSubmit={handleSubmit} noValidate>
            <Textarea
                {...form.getInputProps("comment")}
                aria-label={`Comment on ${eventTitle}`}
                placeholder="Add a comment"
                autosize
                minRows={2}
                maxRows={8}
                onKeyDown={getHotkeyHandler([
                    ["mod+Enter", () => handleSubmit()],
                ])}
            />
            <Group justify="flex-end" align="center" gap="sm" mt="xs">
                {length >= COUNTER_FROM && (
                    <Text size="xs" c={length > MAX_COMMENT_LENGTH ? "red" : "dimmed"} data-testid="comment-counter">
                        {length.toLocaleString("en-US")}/{MAX_COMMENT_LENGTH.toLocaleString("en-US")}
                    </Text>
                )}
                <Button type="submit" size="xs" loading={isPending}>Post comment</Button>
            </Group>
        </form>
    )
}
