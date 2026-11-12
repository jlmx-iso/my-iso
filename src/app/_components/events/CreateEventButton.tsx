"use client";

import { Button, Modal } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPlus } from "@tabler/icons-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

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

    const close = () => {
        setOpenedByButton(false);
        // Drop ?create so the modal does not reopen on reload or back.
        if (openedByLink) router.replace(pathname, { scroll: false });
    };

    const handleCreated = (event: { id: string; title: string }) => {
        close();
        notifications.show({
            color: "teal",
            message: `"${event.title}" is live. Photographers nearby can now apply.`,
            title: "Event created",
        });
        void utils.event.getRecentByLocation.invalidate();
    };

    return (
        <>
            <Button leftSection={<IconPlus size={18} />} size="sm" onClick={() => setOpenedByButton(true)}>
                Create event
            </Button>
            <Modal opened={openedByButton || openedByLink} onClose={close} title="Create event" size="lg">
                <CreateEventForm onCreated={handleCreated} onCancel={close} />
            </Modal>
        </>
    );
}
