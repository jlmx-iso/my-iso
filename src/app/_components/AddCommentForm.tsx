"use client";

import { Button, Container, Textarea } from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { getHotkeyHandler } from '@mantine/hooks';
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
        validate: zodResolver(schema),
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
            <Container w="100%" py="lg">
                <form onSubmit={handleSumbit} style={{ alignItems: "flex-end", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
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