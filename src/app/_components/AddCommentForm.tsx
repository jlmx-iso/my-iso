"use client";

import { Button, Group, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { getHotkeyHandler } from '@mantine/hooks';

import { userFacingError } from "~/_utils/userError";
import { api } from "~/trpc/react";

type AddCommentFormProps = {
    eventId: string;
    eventTitle: string;
};

const MAX_COMMENT_LENGTH = 2000;

export default function AddCommentForm({ eventId, eventTitle }: AddCommentFormProps) {
    const utils = api.useUtils();
    const form = useForm({
        initialValues: {
            comment: "",
        },
        validate: {
            comment: (value: string) => {
                if (!value.trim()) return "Write a comment first";
                return value.length > MAX_COMMENT_LENGTH ? `Keep comments under ${MAX_COMMENT_LENGTH} characters` : null;
            },
        },
    });
    const { mutate, isPending } = api.event.addCommentToEvent.useMutation({
        // The draft stays in the field so a failed post loses nothing.
        onError: (error) =>
            form.setFieldError("comment", userFacingError(error, "Your comment couldn't be posted. Please try again.")),
        onSuccess: () => {
            form.reset();
            void utils.event.getCommentsByEventId.invalidate({ eventId });
            void utils.event.getCommentCountByEventId.invalidate({ eventId });
            void utils.event.getById.invalidate({ id: eventId });
        },
    });

    const handleSubmit = form.onSubmit((values) => {
        if (isPending) return;
        mutate({ content: values.comment.trim(), eventId });
    });

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
            <Group justify="flex-end" mt="xs">
                <Button type="submit" size="xs" loading={isPending}>Post comment</Button>
            </Group>
        </form>
    )
}
