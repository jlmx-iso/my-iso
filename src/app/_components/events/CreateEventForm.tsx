"use client";

import { Alert, Button, FileInput, Group, Select, SimpleGrid, Stack, TextInput, Textarea } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { IconAlertCircle, IconUpload } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useState } from "react";

import { logger } from "~/_utils/logger";
import { userFacingError } from "~/_utils/userError";
import { LocationAutocomplete } from "~/app/_components/LocationAutocomplete";
import { readFileAsBase64 } from "~/app/_lib/readFile";
import { api } from "~/trpc/react";

type CreateEventFormProps = {
    /** Called with the new event once it is saved. */
    onCreated: (event: { id: string; title: string }) => void;
    onCancel: () => void;
};

const MAX_TITLE_LENGTH = 140;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_IMAGE_MB = 5;
const DATE_FORMAT = "YYYY-MM-DD HH:mm:ss";

type FormValues = {
    date: string | null;
    description: string;
    duration: string;
    image: File | null;
    location: string;
    title: string;
};

export default function CreateEventForm({ onCreated, onCancel }: CreateEventFormProps) {
    const createEvent = api.event.create.useMutation();
    const [isReadingImage, setIsReadingImage] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const isSaving = isReadingImage || createEvent.isPending;

    const form = useForm<FormValues>({
        initialValues: {
            // Tomorrow at 10:00: a sensible start that is already valid.
            date: dayjs().add(1, "day").hour(10).minute(0).second(0).format(DATE_FORMAT),
            description: "",
            duration: "4",
            image: null,
            location: "",
            title: "",
        },
        validate: {
            date: (value) => {
                if (!value || !dayjs(value).isValid()) return "Choose a date and time";
                return dayjs(value).isAfter(dayjs()) ? null : "Choose a date and time in the future";
            },
            description: (value) => {
                if (!value.trim()) return "Describe the event so second shooters know what to expect";
                return value.length > MAX_DESCRIPTION_LENGTH
                    ? `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters`
                    : null;
            },
            image: (value) =>
                value && value.size > MAX_IMAGE_MB * 1024 ** 2
                    ? `Choose an image smaller than ${MAX_IMAGE_MB} MB`
                    : null,
            location: (value) => (value.trim() ? null : "Enter where the event is"),
            title: (value) => {
                if (!value.trim()) return "Give the event a title";
                return value.length > MAX_TITLE_LENGTH ? `Keep the title under ${MAX_TITLE_LENGTH} characters` : null;
            },
        },
    });

    const handleSubmit = form.onSubmit(async (values) => {
        if (isSaving) return;
        setSubmitError(null);
        try {
            let image: string | undefined;
            if (values.image) {
                setIsReadingImage(true);
                image = await readFileAsBase64(values.image);
            }
            const event = await createEvent.mutateAsync({
                date: dayjs(values.date).toISOString(),
                description: values.description.trim(),
                duration: Number(values.duration),
                image,
                location: values.location.trim(),
                title: values.title.trim(),
            });
            onCreated({ id: event.id, title: event.title });
        } catch (error) {
            // Keep the form and everything in it; say what went wrong.
            logger.error("Error creating event", { error });
            setSubmitError(userFacingError(error, "We couldn't create your event. Your details are still here — please try again."));
        } finally {
            setIsReadingImage(false);
        }
    });

    return (
        <form onSubmit={handleSubmit} noValidate>
            <Stack gap="md">
                {/* Always rendered so screen readers announce errors as they appear. */}
                <div role="alert" aria-live="assertive">
                    {submitError && (
                        <Alert color="red" icon={<IconAlertCircle size={16} />} data-testid="create-event-error">
                            {submitError}
                        </Alert>
                    )}
                </div>
                <TextInput
                    label="Title"
                    placeholder="Second shooter for a downtown wedding"
                    required
                    maxLength={MAX_TITLE_LENGTH}
                    data-autofocus
                    {...form.getInputProps("title")}
                />
                <Textarea
                    label="Description"
                    description={`${form.values.description.length}/${MAX_DESCRIPTION_LENGTH} characters`}
                    placeholder="The schedule, the style, the gear you expect, the pay…"
                    required
                    autosize
                    minRows={3}
                    maxRows={6}
                    {...form.getInputProps("description")}
                />
                <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md">
                    <DateTimePicker
                        label="Date and time"
                        valueFormat="DD MMM YYYY hh:mm A"
                        required
                        withSeconds={false}
                        minDate={dayjs().format(DATE_FORMAT)}
                        firstDayOfWeek={0}
                        {...form.getInputProps("date")}
                    />
                    <Select
                        label="Duration"
                        required
                        allowDeselect={false}
                        data={[
                            { value: "1", label: "1 hour" },
                            { value: "2", label: "2 hours" },
                            { value: "3", label: "3 hours" },
                            { value: "4", label: "4 hours" },
                            { value: "6", label: "6 hours" },
                            { value: "8", label: "8 hours (full day)" },
                            { value: "10", label: "10 hours" },
                            { value: "12", label: "12 hours" },
                        ]}
                        {...form.getInputProps("duration")}
                    />
                </SimpleGrid>
                <LocationAutocomplete
                    label="Location"
                    isRequired
                    placeholder="Austin, TX"
                    {...form.getInputProps("location")}
                />
                <FileInput
                    label="Cover image"
                    description={`Optional. JPG, PNG or WebP, up to ${MAX_IMAGE_MB} MB.`}
                    leftSection={<IconUpload size={16} />}
                    placeholder="Choose an image"
                    accept="image/png,image/jpeg,image/webp"
                    clearable
                    {...form.getInputProps("image")}
                />
                <Group justify="flex-end" mt="xs">
                    <Button variant="default" onClick={onCancel} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button type="submit" loading={isSaving}>
                        Create event
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}
