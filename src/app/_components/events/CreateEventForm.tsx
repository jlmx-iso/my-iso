"use client";

import { Button, FileInput, NumberInput, TextInput, Textarea } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { IconUpload } from "@tabler/icons-react";
import dayjs from "dayjs";
import { zod4Resolver } from "mantine-form-zod-resolver";
import { z } from "zod";

import { Loader } from "../Loader";

import { LocationAutocomplete } from "~/app/register/_components";
import { api } from "~/trpc/react";


type CreateEventProps = {
    title?: string;
};

const MAX_DESCRIPTION_LENGTH = 1000;

const schema = z.object({
    date: z.string().refine((val) => {
        const date = dayjs(val);
        return date.isValid() && date.isAfter(dayjs());
    }, "Date must be in the future"),
    description: z.string().max(MAX_DESCRIPTION_LENGTH, `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less`),
    duration: z.number().min(1, "Duration must be at least 1 hour"),
    // image: z.union([z.instanceof(File), z.string()]).optional(),
image: typeof window === 'undefined' ? z.any() : z.instanceof(File).optional(),

location: z.string().min(1, "Location is required"),

    title: z.string().max(140, "Title is required an must be less than 140 characters"),
});

export default function CreateEventForm({ title }: CreateEventProps) {
    const { mutateAsync, mutate, isPending, isError, isSuccess } = api.event.create.useMutation();
    const form = useForm({
        initialValues: {
            date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
            description: "",
            duration: 1,
            image: undefined,
            location: "",
            title: title ?? "",
        },
        validate: zod4Resolver(schema)
    });

    const handleSubmit = (values: typeof form.values) => {
        const image = values.image as File | undefined
        const date = dayjs(values.date).toISOString();
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

    if (isPending) {
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
            <DateTimePicker label="Date" valueFormat="DD MMM YYYY hh:mm A" required withSeconds={false} minDate={dayjs().format('YYYY-MM-DD HH:mm:ss')} firstDayOfWeek={0} {...form.getInputProps("date")} />
            <NumberInput label="Hours" required min={1} max={24} {...form.getInputProps("duration")} />
            <LocationAutocomplete label="City, State" isRequired placeholder="Austin, TX" {...form.getInputProps("location")} />
            <FileInput label="Image" leftSection={<IconUpload />} placeholder="Upload Image" accept="image/*" {...form.getInputProps("image")} />
            <Button type="submit" disabled={!form.isValid} style={{ marginTop: "1em", right: 0 }}>Create Event</Button>
        </form>
    );
}