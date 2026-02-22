"use client";

import { Autocomplete, Loader, Stepper } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconMessagePlus } from "@tabler/icons-react";
import { useState } from "react";

import ComposeMessage from "./ComposeMessage";

import { Modal } from "~/app/_components/Modal";
import { api } from "~/trpc/react";

export type Recipient = {
    photographer: {
        companyName: string;
        id: string;
    } | null;
    firstName: string;
    lastName: string;
    id: string;
    profilePic: string | null;
};

export default function NewMessageModal() {
    const [recipientQuery, setRecipientQuery] = useState('');
    const [recipient, setRecipient] = useState<Recipient>();
    const [active, setActive] = useState(0);
    const [opened, { close }] = useDisclosure(false);
    const nextStep = () => setActive((current) => (current < 2 ? current + 1 : current));

    const { data: potentialRecipients = [], isPending } = api.message.getPotentialRecipients.useQuery(
        { query: recipientQuery },
        { enabled: recipientQuery.length > 1 },
    );

    return (
        <Modal isIconModal={false} opened={opened} buttonLabel="New Message" buttonProps={{ leftSection: <IconMessagePlus size={18} />, size: "sm" }} title="New Message">
            <Stepper active={active}>
                <Stepper.Step withIcon={false}>
                    <Autocomplete
                        label="Recipient"
                        placeholder="Search for a recipient"
                        data={potentialRecipients.map((r) => ({
                            value: r.id,
                            label: `${r.firstName} ${r.lastName}`,
                        }))}
                        rightSection={isPending ? <Loader size="xs" /> : null}
                        onChange={(value) => setRecipientQuery(value)}
                        onOptionSubmit={(id) => {
                            const selected = potentialRecipients.find((r) => r.id === id);
                            if (selected) {
                                setRecipient(selected);
                                nextStep();
                            }
                        }}
                    />
                </Stepper.Step>
                <Stepper.Step withIcon={false}>
                    {recipient && <ComposeMessage recipient={recipient} />}
                </Stepper.Step>
            </Stepper>
        </Modal>
    );
}