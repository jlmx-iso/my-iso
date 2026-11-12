"use client";

import { Button, Modal } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import ConfirmDialog from "~/app/_components/ConfirmDialog";
import { dialogLock } from "~/app/_components/dialogFailure";
import { notify } from "~/app/_lib/notify";
import { api } from "~/trpc/react";

import CreateEventForm from "./CreateEventForm";

/** Query parameter that opens the modal: `/app/events?create=1`. */
const CREATE_EVENT_PARAM = "create";

/**
 * "Create event" button and modal. The modal also opens from a link to
 * `/app/events?create=1` (used at the end of onboarding).
 */
export default function CreateEventButton() {
    const router = useRouter();
    const pathname = usePathname();
    const utils = api.useUtils();
    const openedByLink = useSearchParams().has(CREATE_EVENT_PARAM);
    const [openedByButton, setOpenedByButton] = useState(false);
    // Something has been typed into the form: closing would lose it.
    const [hasDraft, setHasDraft] = useState(false);
    const [confirmingDiscard, setConfirmingDiscard] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const close = () => {
        setHasDraft(false);
        setIsSaving(false);
        setConfirmingDiscard(false);
        setOpenedByButton(false);
        // Drop ?create so the modal does not reopen on reload or back.
        if (openedByLink) router.replace(pathname, { scroll: false });
    };

    /** Escape, the overlay, the close button and Cancel: ask before losing a draft. */
    const requestClose = () => {
        // Not while the event is being saved: its outcome is shown in the dialog.
        if (isSaving) return;
        if (hasDraft) setConfirmingDiscard(true);
        else close();
    };

    const handleCreated = (event: { id: string; title: string }) => {
        close();
        notify.success({
            message: `"${event.title}" is live. Photographers nearby can now apply.`,
            title: "Event created",
        });
        void utils.event.getFeedPage.invalidate();
    };

    return (
        <>
            <Button leftSection={<IconPlus size={18} />} size="sm" onClick={() => setOpenedByButton(true)}>
                Create event
            </Button>
            <Modal
                opened={openedByButton || openedByLink}
                onClose={requestClose}
                {...dialogLock(isSaving)}
                // The confirmation on top handles Escape while it is open.
                closeOnEscape={!confirmingDiscard && !isSaving}
                title="Create event"
                size="lg"
            >
                <CreateEventForm
                    onCreated={handleCreated}
                    onCancel={requestClose}
                    onDirtyChange={setHasDraft}
                    onSavingChange={setIsSaving}
                />
            </Modal>
            <ConfirmDialog
                opened={confirmingDiscard}
                onClose={() => setConfirmingDiscard(false)}
                onConfirm={close}
                title="Discard this event?"
                confirmLabel="Discard draft"
                cancelLabel="Keep editing"
                destructive
            >
                What you&apos;ve written so far will be lost.
            </ConfirmDialog>
        </>
    );
}
