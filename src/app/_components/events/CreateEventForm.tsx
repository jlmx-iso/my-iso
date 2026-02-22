"use client";

import { Button, FileInput, Group, NumberInput, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconUpload } from "@tabler/icons-react";
import dayjs from "dayjs";
import { zod4Resolver } from "mantine-form-zod-resolver";
import { z } from "zod";

import { Loader } from "../Loader";

import { LocationAutocomplete } from "~/app/_components/LocationAutocomplete";
import { logger } from "~/_utils";
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
    image: typeof window === 'undefined' ? z.any() : z.instanceof(File).optional(),
    location: z.string().min(1, "Location is required"),
    title: z.string().max(140, "Title is required an must be less than 140 characters"),
});

export default function CreateEventForm({ title }: CreateEventProps) {
    const { mutateAsync, mutate, isPending, isError, isSuccess, reset } = api.event.create.useMutation();
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
                const base64File = reader.result?.toString().split(',')[1];

                if (base64File) {
                    try {
                        await mutateAsync({ ...values, date, image: base64File });
                    } catch (error) {
                        logger.error('Error uploading event image', { error });
                        notifications.show({
                            title: 'Upload Failed',
                            message: 'Failed to upload image. Please try again.',
                            color: 'red',
                        });
                    }
                }
            };
            reader.onerror = () => {
                logger.error('Error reading file');
                notifications.show({
                    title: 'File Error',
                    message: 'Could not read the selected file. Please try a different image.',
                    color: 'red',
                });
            };
            reader.readAsDataURL(image);
            return;
        }

        mutate({ ...values, date, image: undefined });
    }

    if (isPending) {
        return <Loader />;
    }

    if (isSuccess) {
        return (
            <Stack align="center" gap="md" py="xl">
                <IconCheck size={40} color="var(--mantine-color-teal-5)" />
                <Text fw={500}>Event created successfully!</Text>
            </Stack>
        );
    }

    if (isError) {
        return (
            <Stack align="center" gap="sm" py="xl">
                <Text fw={500} c="red">Something went wrong</Text>
                <Text size="sm" c="dimmed">
                    We couldn&apos;t create your event. Please try again.
                </Text>
                <Button variant="light" onClick={reset}>
                    Try again
                </Button>
            </Stack>
        );
    }

    return (
        <form onSubmit={form.onSubmit(handleSubmit)}>
            <Stack gap="md">
                <TextInput label="Title" required {...form.getInputProps("title")} />
                <Textarea
                    label="Description"
                    required
                    maxLength={MAX_DESCRIPTION_LENGTH + 1}
                    autosize
                    minRows={3}
                    maxRows={6}
                    {...form.getInputProps("description")}
                />
                <Group grow>
                    <DateTimePicker
                        label="Date"
                        valueFormat="DD MMM YYYY hh:mm A"
                        required
                        withSeconds={false}
                        minDate={dayjs().format('YYYY-MM-DD HH:mm:ss')}
                        firstDayOfWeek={0}
                        {...form.getInputProps("date")}
                    />
                    <NumberInput
                        label="Duration (hours)"
                        required
                        min={1}
                        max={24}
                        {...form.getInputProps("duration")}
                    />
                </Group>
                <LocationAutocomplete
                    label="Location"
                    isRequired
                    placeholder="Austin, TX"
                    {...form.getInputProps("location")}
                />
                <FileInput
                    label="Cover Image"
                    leftSection={<IconUpload size={16} />}
                    placeholder="Upload an image"
                    accept="image/*"
                    {...form.getInputProps("image")}
                />
                <Button type="submit" disabled={!form.isValid} mt="xs">
                    Create Event
                </Button>
            </Stack>
        </form>
    );
}
