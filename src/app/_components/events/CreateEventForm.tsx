"use client";

import { Button, FileInput, NumberInput, Textarea, TextInput } from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { DateTimePicker } from "@mantine/dates";
import { z } from "zod";
import { LocationAutocomplete } from "~/app/register/_components";
import { IconUpload } from "@tabler/icons-react";
import { api } from "~/trpc/react";
import { Loader } from "../Loader";

type CreateEventProps = {
    title?: string;
};

const MAX_DESCRIPTION_LENGTH = 1000;

const schema = z.object({
    title: z.string().max(140, "Title is required an must be less than 140 characters"),
    description: z.string().max(MAX_DESCRIPTION_LENGTH, `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less`),
    date: z.date().min(new Date(), "Date must be in the future"),
    duration: z.number().min(1, "Duration must be at least 1 hour"),
    location: z.string().min(1, "Location is required"),
    // image: z.union([z.instanceof(File), z.string()]).optional(),
    image: typeof window === 'undefined' ? z.any() : z.instanceof(File).optional(),
});

export default function CreateEventForm({ title }: CreateEventProps) {
    const { mutateAsync, mutate, isLoading, isError, isSuccess } = api.event.create.useMutation();
    const form = useForm({
        initialValues: {
            title: title ?? "",
            description: "",
            date: new Date(),
            duration: 1,
            location: "",
            image: undefined,
        },
        validate: zodResolver(schema)
    });

    const handleSubmit = (values: typeof form.values) => {
        const image = values.image as File | undefined
        const date = values.date.toISOString();
        const reader = new FileReader();
        if (image) {
            reader.onloadend = async () => {
                const base64File = reader.result?.toString().split(',')[1]; // Get base64 string without the prefix

                if (base64File) {
                    try {
                        await mutateAsync({ ...values, date, image: base64File });
                    } catch (error) {
                        // TODO: Figure out how to handle error
                        // eslint-disable-next-line no-console
                        console.error('Error uploading image:', error);
                    }
                }
            };
            reader.readAsDataURL(image); // Convert image to base64
            return;
        }

        mutate({ ...values, date, image: undefined });
    }

    if (isLoading) {
        return <Loader />;
    }

    if (isSuccess) {
        return <div>Event created successfully!</div>;
    }

    if (isError) {
        return <div>Uh oh, it seems something went wrong while creating the event. Please try again later.</div>;
    }

    return (
        <form onSubmit={form.onSubmit(handleSubmit)}>
            <TextInput label="Title" required {...form.getInputProps("title")} />
            <Textarea label="Description" required maxLength={MAX_DESCRIPTION_LENGTH + 1} autosize minRows={2} maxRows={4} {...form.getInputProps("description")} />
            <DateTimePicker label="Date" valueFormat="DD MMM YYYY hh mm A" required withSeconds={false} minDate={new Date()} firstDayOfWeek={0} {...form.getInputProps("date")} />
            <NumberInput label="Hours" required min={1} max={24} {...form.getInputProps("duration")} />
            <LocationAutocomplete label="City, State" isRequired placeholder="Austin, TX" {...form.getInputProps("location")} />
            <FileInput label="Image" leftSection={<IconUpload />} placeholder="Upload Image" accept="image/*" {...form.getInputProps("image")} />
            <Button type="submit" disabled={!form.isValid} style={{ marginTop: "1em", right: 0 }}>Create Event</Button>
        </form>
    );
}