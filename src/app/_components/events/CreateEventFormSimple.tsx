"use client";

import { Stack, Textarea } from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { getHotkeyHandler } from "@mantine/hooks";
import { z } from "zod";

import { Modal } from "../Modal";
import CreateEventForm from "./CreateEventForm";

const MAX_TITLE_LENGTH = 140;

const schema = z.object({
    title: z.string().max(MAX_TITLE_LENGTH, "Title must be between 1 and 140 characters"),
});

export default function CreateEventFormSimple() {
    const form = useForm({
        initialValues: {
            title: "",
        },
        validate: zodResolver(schema),
        validateInputOnChange: true,
    });

    return (
        <Stack pos="relative">
            <Textarea onKeyDown={getHotkeyHandler([
                ["mod+Enter", () => { return }],
            ])} aria-label="Create an Event" placeholder="Create an event..." autosize minRows={4} maxRows={4} maxLength={MAX_TITLE_LENGTH + 1} required key={form.key("title")} {...form.getInputProps("title")} />
            <Modal onClose={form.reset} title="Create Event" buttonLabel="Create" isIconModal={false} buttonProps={{ bottom: "0.5em", disabled: !form.values.title.length, pos: "absolute", right: "0.5em" }}>
                <CreateEventForm title={form.values.title} />
            </Modal>
        </Stack >
    );
}