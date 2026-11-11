"use client";

import { Button, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { getHotkeyHandler } from '@mantine/hooks';
import { zod4Resolver } from "mantine-form-zod-resolver";
import { z } from "zod";

import { Loader } from "./Loader";
import { Notification } from "./Notification";

import { useCommentsRefetch } from "~/context/CommentsRefetchContext";
import { api } from "~/trpc/react";



type AddCommentFormProps = {
    eventId: string;
};

const schema = z.object({
    comment: z.string().min(1, "Comment is required"),
});

export default function AddCommentForm({ eventId }: AddCommentFormProps) {
    const commentRefetcher = useCommentsRefetch();
    const form = useForm({
        initialValues: {
            comment: "",
        },
        validate: zod4Resolver(schema),
    });
    const { mutate, isPending, error } = api.event.addCommentToEvent.useMutation({
        onSuccess: () => {
            commentRefetcher.refetchComments()
            commentRefetcher.refetchCommentCount()
        }
    });

    const handleSumbit = (form.onSubmit((values) => {
        mutate({
            content: values.comment,
            eventId,
        });
        form.reset();
    }));

    if (isPending) {
        return <Loader />
    }


    return (
        <>
            {error && <Notification type="error" autoDismiss={5000} >Error adding comment</Notification>}
            <form onSubmit={handleSumbit} style={{ alignItems: "flex-end", display: "flex", flexDirection: "column", gap: 8 }}>
                <Textarea
                    {...form.getInputProps("comment")}
                    w="100%"
                    placeholder="Add a comment"
                    required
                    autosize
                    minRows={2}
                    onKeyDown={getHotkeyHandler([
                        ["mod+Enter", handleSumbit],
                    ])}
                />
                <Button type="submit" size="xs">Add Comment</Button>
            </form>
        </>
    )
};