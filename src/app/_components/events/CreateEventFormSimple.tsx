"use client";

import { IconPlus } from "@tabler/icons-react";

import { Modal } from "../Modal";
import CreateEventForm from "./CreateEventForm";

export default function CreateEventFormSimple() {
    return (
        <Modal
            title="Create Event"
            buttonLabel="Create Event"
            isIconModal={false}
            buttonProps={{
                leftSection: <IconPlus size={18} />,
                size: "sm",
                style: { alignSelf: "flex-start" },
            }}
        >
            <CreateEventForm />
        </Modal>
    );
}
