"use client";

import { Button, Container, Textarea } from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { getHotkeyHandler } from '@mantine/hooks';
import { api } from "~/trpc/react";
import { Loader } from "./Loader";
import { z } from "zod";
import { Notification } from "./Notification";
import { useCommentsRefetch } from "~/context/CommentsRefetchContext";

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
        validate: zodResolver(schema),
    });
    const { mutate, isLoading, error } = api.event.addCommentToEvent.useMutation();

    const handleSumbit = (form.onSubmit((values) => {
        mutate({
            eventId,
            content: values.comment,
        }, {
            onSuccess: () => {
                commentRefetcher.refetchComments()
                commentRefetcher.refetchCommentCount()
            }
        });
        form.reset();
    }));

    if (isLoading) {
        return <Loader />
    }


    return (
        <>
            {error && <Notification type="error" autoDismiss={5000} >Error adding comment</Notification>}
            <Container w="100%" py="lg">
                <form onSubmit={handleSumbit} style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "flex-end" }}>
                    <Textarea
                        {...form.getInputProps("comment")}
                        w="100%"
                        placeholder="Add a comment"
                        required
                        my="md"
                        onKeyDown={getHotkeyHandler([
                            ["mod+Enter", handleSumbit],
                        ])}
                    />
                    <Button type="submit" maw="140">Add Comment</Button>
                </form>
            </Container>
        </>
    )
};