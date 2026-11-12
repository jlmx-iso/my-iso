"use client";

import { Button, FileInput, Group, NumberInput, Select, SimpleGrid, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { IconUpload } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import { localTimeZone, timeZoneLabel } from "~/_lib/eventTime";
import { EVENT_DATE_FORMAT, defaultEventStart, eventDateError, latestEventStart } from "~/_utils/eventDates";
import { MAX_EVENT_PAY_CENTS, payCentsToDollars, payDollarsToCents, payError } from "~/_utils/eventPay";
import {
    IMAGE_ACCEPT,
    IMAGE_TOO_LARGE_MESSAGE,
    IMAGE_TYPES_LABEL,
    IMAGE_WRONG_TYPE_MESSAGE,
    MAX_IMAGE_MB,
    imageFileError,
    uploadErrorMessage,
} from "~/_utils/imageFile";
import { MAX_EVENT_DURATION_HOURS } from "~/_utils/limits";
import { logger } from "~/_utils/logger";
import { isRateLimited, trpcErrorCode, zodErrorFields } from "~/_utils/userError";
import DialogError from "~/app/_components/DialogError";
import { routeFailure } from "~/app/_components/dialogFailure";
import { LocationAutocomplete } from "~/app/_components/LocationAutocomplete";
import { useIsMounted } from "~/app/_hooks/useIsMounted";
import { notify } from "~/app/_lib/notify";
import { readFileAsBase64 } from "~/app/_lib/readFile";
import { api } from "~/trpc/react";

/** An event being edited: the form starts from it and saves changes to it. */
export type EditableEvent = {
    id: string;
    title: string;
    description: string | null;
    date: Date | string;
    duration: number;
    location: string;
    payCents: number | null;
};

type CreateEventFormProps = {
    /** Edit this event instead of creating one. */
    event?: EditableEvent;
    /** Called with the event once it is saved (created, or edited). */
    onCreated: (event: { id: string; title: string }) => void;
    onCancel: () => void;
    /** Told whether anything has been typed, so closing can ask first. */
    onDirtyChange?: (isDirty: boolean) => void;
    /** Told when a save starts and ends, so the dialog cannot be closed under it. */
    onSavingChange?: (isSaving: boolean) => void;
};

const MAX_TITLE_LENGTH = 140;
const MAX_DESCRIPTION_LENGTH = 1000;
const SAVE_FAILED = "We couldn't create your event. Your details are still here — please try again.";
const EDIT_FAILED = "We couldn't save your changes. They are still here — please try again.";
const COVER_FAILED = "The cover image couldn't be uploaded, so the event wasn't posted. Everything else is still here.";
const EDIT_COVER_FAILED = "The cover image couldn't be uploaded, so nothing was saved. Everything else is still here.";
/** In the order the fields appear, for moving focus to the first invalid one. */
const FIELD_ORDER = ["title", "description", "date", "duration", "location", "pay", "image"] as const;

/**
 * Whether a failed create was about the cover image: the image itself was
 * refused, or the image host could not take it.
 */
function isCoverFailure(error: unknown, hadImage: boolean): boolean {
    if (!hadImage) return false;
    if (zodErrorFields(error).includes("image")) return true;
    const code = trpcErrorCode(error);
    // The image was refused, or uploads are being rate limited.
    if (code === "PAYLOAD_TOO_LARGE" || code === "UNSUPPORTED_MEDIA_TYPE" || isRateLimited(error)) return true;
    // The image host did not take it ("Error uploading image").
    return error instanceof Error && /upload/i.test(error.message);
}

/** Whole hours, as the server requires (1 to MAX_EVENT_DURATION_HOURS). */
const DURATION_HOURS = [1, 2, 3, 4, 6, 8, 10, 12, 24, 48, 72].filter((hours) => hours <= MAX_EVENT_DURATION_HOURS);
const durationLabel = (hours: number) => {
    if (hours === 1) return "1 hour";
    if (hours === 8) return "8 hours (full day)";
    if (hours >= 24 && hours % 24 === 0) return `${hours / 24} ${hours === 24 ? "day" : "days"} (${hours} hours)`;
    return `${hours} hours`;
};

type FormValues = {
    date: string | null;
    description: string;
    duration: string;
    image: File | null;
    location: string;
    /** Dollars, as NumberInput gives them; "" when not listed. */
    pay: number | string;
    title: string;
};

function initialValuesOf(event: EditableEvent | undefined): FormValues {
    if (!event) {
        return {
            // Tomorrow at 10:00: a sensible start that is already valid.
            date: defaultEventStart(),
            description: "",
            duration: "4",
            image: null,
            location: "",
            pay: "",
            title: "",
        };
    }
    return {
        date: dayjs(event.date).format(EVENT_DATE_FORMAT),
        description: event.description ?? "",
        duration: String(event.duration),
        image: null,
        location: event.location,
        pay: payCentsToDollars(event.payCents),
        title: event.title,
    };
}

/**
 * The event form, for posting an event and (with `event`) editing one. The
 * start time is entered in the poster's own time zone, which is saved with
 * it so everyone sees the time labelled with that zone.
 */
export default function CreateEventForm({ event: editing, onCreated, onCancel, onDirtyChange, onSavingChange }: CreateEventFormProps) {
    const createEvent = api.event.create.useMutation();
    const updateEvent = api.event.update.useMutation();
    const isEdit = editing !== undefined;
    const [isReadingImage, setIsReadingImage] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    // The last attempt failed on the cover image: offer to post without it.
    const [coverFailed, setCoverFailed] = useState(false);
    const isSaving = isReadingImage || createEvent.isPending || updateEvent.isPending;
    useEffect(() => onSavingChange?.(isSaving), [isSaving, onSavingChange]);
    // Whether the form (and so its dialog) is still on screen when a save ends.
    const isMounted = useIsMounted();

    const [initialValues] = useState(() => initialValuesOf(editing));
    const form = useForm<FormValues>({
        initialValues,
        validate: {
            // An edit may keep the date it has, even once it has passed.
            date: (value) => (isEdit && value === initialValues.date ? null : eventDateError(value)),
            description: (value) => {
                if (!value.trim()) return "Describe the event so second shooters know what to expect";
                return value.length > MAX_DESCRIPTION_LENGTH
                    ? `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters`
                    : null;
            },
            image: (value) => (value ? imageFileError(value) : null),
            location: (value) => (value.trim() ? null : "Enter where the event is"),
            pay: (value) => payError(value),
            title: (value) => {
                if (!value.trim()) return "Give the event a title";
                return value.length > MAX_TITLE_LENGTH ? `Keep the title under ${MAX_TITLE_LENGTH} characters` : null;
            },
        },
        // What the member typed, as opposed to the defaults: a draft worth
        // asking about before it is thrown away.
        onValuesChange: (values) =>
            onDirtyChange?.(
                isEdit
                    ? values.title !== initialValues.title ||
                      values.description !== initialValues.description ||
                      values.location !== initialValues.location ||
                      values.date !== initialValues.date ||
                      values.duration !== initialValues.duration ||
                      String(values.pay) !== String(initialValues.pay) ||
                      values.image !== null
                    : values.title.trim() !== "" ||
                      values.description.trim() !== "" ||
                      values.location.trim() !== "" ||
                      values.pay !== "" ||
                      values.image !== null,
            ),
    });
    // The zone the picker's times are in: the browser's, saved with the event.
    const timeZone = localTimeZone();
    const zoneName = form.values.date && dayjs(form.values.date).isValid()
        ? timeZoneLabel(dayjs(form.values.date).toDate(), timeZone)
        : "";

    const save = async (values: FormValues, withCover: boolean) => {
        if (isSaving) return;
        setSubmitError(null);
        setCoverFailed(false);
        const cover = withCover ? values.image : null;
        try {
            let image: string | undefined;
            if (cover) {
                setIsReadingImage(true);
                image = await readFileAsBase64(cover);
            }
            const fields = {
                description: values.description.trim(),
                duration: Number(values.duration),
                image,
                location: values.location.trim(),
                payCents: payDollarsToCents(values.pay),
                title: values.title.trim(),
            };
            const dateChanged = !isEdit || values.date !== initialValues.date;
            // A new or moved start time is in this browser's zone: say which.
            const when = dateChanged
                ? { date: dayjs(values.date).toISOString(), ...(timeZone ? { timeZone } : {}) }
                : {};
            const event = editing
                ? await updateEvent.mutateAsync({ id: editing.id, ...fields, ...when })
                : await createEvent.mutateAsync({ ...fields, date: dayjs(values.date).toISOString(), ...(timeZone ? { timeZone } : {}) });
            onCreated({ id: event.id, title: event.title });
        } catch (error) {
            // Keep the form and everything in it; say what went wrong.
            logger.error(isEdit ? "Error updating event" : "Error creating event", { error });
            const message = uploadErrorMessage(error, isEdit ? EDIT_FAILED : SAVE_FAILED);
            // The dialog is gone (it should not be closable mid-save, but if
            // it is): the failure must still be seen.
            if (routeFailure({ dialogOpen: isMounted(), stale: false }).show === "toast") {
                notify.error(
                    isEdit
                        ? { message, title: "Changes not saved" }
                        : { message: `${message} Your draft was not posted.`, title: "Event not posted" },
                );
                return;
            }
            // A refused image is reported on the image field as well.
            if (message === IMAGE_TOO_LARGE_MESSAGE || message === IMAGE_WRONG_TYPE_MESSAGE) {
                form.setFieldError("image", message);
                setCoverFailed(true);
                setSubmitError(`${message} ${isEdit ? "Nothing was saved." : "The event wasn't posted."}`);
            } else if (isCoverFailure(error, cover !== null)) {
                setCoverFailed(true);
                setSubmitError(isEdit ? EDIT_COVER_FAILED : COVER_FAILED);
            } else {
                setSubmitError(message);
            }
        } finally {
            setIsReadingImage(false);
        }
    };

    const handleSubmit = form.onSubmit(
        (values) => void save(values, true),
        // Invalid: take the keyboard to the first field that needs fixing.
        (errors) => {
            const first = FIELD_ORDER.find((field) => errors[field] != null && errors[field] !== false);
            if (first) form.getInputNode(first)?.focus();
        },
    );

    return (
        <form onSubmit={handleSubmit} noValidate>
            <Stack gap="md">
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
                        description={zoneName ? `Start time, in your time zone (${zoneName})` : "Start time, in your time zone"}
                        valueFormat="DD MMM YYYY hh:mm A"
                        required
                        withSeconds={false}
                        minDate={isEdit ? undefined : dayjs().format(EVENT_DATE_FORMAT)}
                        maxDate={dayjs(latestEventStart()).format(EVENT_DATE_FORMAT)}
                        firstDayOfWeek={0}
                        {...form.getInputProps("date")}
                    />
                    <Select
                        label="Duration"
                        required
                        allowDeselect={false}
                        data={DURATION_HOURS.map((hours) => ({ label: durationLabel(hours), value: String(hours) }))}
                        {...form.getInputProps("duration")}
                    />
                </SimpleGrid>
                <LocationAutocomplete
                    label="Location"
                    isRequired
                    placeholder="Austin, TX"
                    {...form.getInputProps("location")}
                />
                <NumberInput
                    label="Pay"
                    description="For the whole event, in US dollars. Optional: leave it empty and applicants propose a rate."
                    placeholder="450"
                    prefix="$"
                    thousandSeparator=","
                    decimalScale={2}
                    allowNegative={false}
                    min={0}
                    max={MAX_EVENT_PAY_CENTS / 100}
                    clampBehavior="none"
                    hideControls
                    inputMode="decimal"
                    {...form.getInputProps("pay")}
                />
                <FileInput
                    label={isEdit ? "New cover image" : "Cover image"}
                    description={`Optional. ${IMAGE_TYPES_LABEL}, up to ${MAX_IMAGE_MB} MB.${isEdit ? " Leave empty to keep the current one." : ""}`}
                    leftSection={<IconUpload size={16} />}
                    placeholder="Choose an image"
                    accept={IMAGE_ACCEPT.join(",")}
                    clearable
                    {...form.getInputProps("image")}
                    onChange={(file) => {
                        form.setFieldValue("image", file);
                        // Say so at once, not only on "Create event".
                        form.setFieldError("image", file ? imageFileError(file) : null);
                    }}
                />
                {/* Above the buttons, where the eye is after pressing one. */}
                <DialogError message={submitError} title={isEdit ? "Changes not saved" : "Event not posted"} data-testid="create-event-error">
                    {coverFailed && (
                        <Group gap="xs" mt="xs">
                            <Button
                                size="xs"
                                className="touch-target"
                                variant="default"
                                onClick={() => void save(form.values, false)}
                                disabled={isSaving}
                                data-testid="post-without-cover"
                            >
                                {isEdit ? "Save without new cover" : "Post without cover"}
                            </Button>
                            <Text size="xs" c="dimmed">You can add one later by editing the event.</Text>
                        </Group>
                    )}
                </DialogError>
                <Group justify="flex-end" mt="xs">
                    <Button variant="default" onClick={onCancel} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button type="submit" loading={isSaving}>
                        {isEdit ? "Save changes" : "Create event"}
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}
