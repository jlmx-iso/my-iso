"use client";

import { Button, Modal } from "@mantine/core";
import { IconPencil } from "@tabler/icons-react";
import { useState } from "react";

import ConfirmDialog from "~/app/_components/ConfirmDialog";
import { dialogLock } from "~/app/_components/dialogFailure";
import { notify } from "~/app/_lib/notify";
import { api } from "~/trpc/react";

import CreateEventForm, { type EditableEvent } from "./CreateEventForm";

/**
 * "Edit event" button and dialog for the event's owner: title, details,
 * time, pay and cover. Closing with unsaved changes asks first, as the
 * create dialog does.
 */
export default function EditEventButton({ event }: { event: EditableEvent }) {
    const utils = api.useUtils();
    const [opened, setOpened] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const [confirmingDiscard, setConfirmingDiscard] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const close = () => {
        setHasChanges(false);
        setIsSaving(false);
        setConfirmingDiscard(false);
        setOpened(false);
    };

    const requestClose = () => {
        if (isSaving) return;
        if (hasChanges) setConfirmingDiscard(true);
        else close();
    };

    const handleSaved = (saved: { id: string; title: string }) => {
        close();
        notify.success({ message: `"${saved.title}" is updated.`, title: "Changes saved" });
        void utils.event.getById.invalidate({ id: saved.id });
        void utils.event.getFeedPage.invalidate();
    };

    return (
        <>
            <Button
                variant="default"
                size="sm"
                leftSection={<IconPencil size={16} aria-hidden />}
                onClick={() => setOpened(true)}
                data-testid="edit-event"
            >
                Edit event
            </Button>
            <Modal
                opened={opened}
                onClose={requestClose}
                {...dialogLock(isSaving)}
                closeOnEscape={!confirmingDiscard && !isSaving}
                title="Edit event"
                size="lg"
            >
                <CreateEventForm
                    event={event}
                    onCreated={handleSaved}
                    onCancel={requestClose}
                    onDirtyChange={setHasChanges}
                    onSavingChange={setIsSaving}
                />
            </Modal>
            <ConfirmDialog
                opened={confirmingDiscard}
                onClose={() => setConfirmingDiscard(false)}
                onConfirm={close}
                title="Discard your changes?"
                confirmLabel="Discard changes"
                cancelLabel="Keep editing"
                destructive
            >
                The event stays as it was.
            </ConfirmDialog>
        </>
    );
}
