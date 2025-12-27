"use client";

import { Autocomplete, Stepper, Text, useCombobox } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconMessagePlus } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
    const router = useRouter();
    const combobox = useCombobox({
        onDropdownClose: () => combobox.resetSelectedOption(),
    })
    const [recipientQuery, setRecipientQuery] = useState<string>('');
    const [recipient, setRecipient] = useState<Recipient>();
    const [potentialRecipients, setPotentialRecipients] = useState<Recipient[]>([]);
    const [active, setActive] = useState(0);
    const [opened, { open, close }] = useDisclosure(false);
    const nextStep = () => setActive((current) => (current < 2 ? current + 1 : current));

    const { data: potentialRecipientData = [], isSuccess, isError, isPending } = api.message.getPotentialRecipients.useQuery({ query: recipientQuery }, {
        enabled: recipientQuery.length > 1,
        initialData: [],
        refetchInterval: 500,
    });

    const { data: messageThread, isSuccess: messageThreadSuccess, isError: messageThreadError } = api.message.getThreadByParticipants.useQuery({ participants: [recipient?.id ?? ""] }, {
        enabled: false,
    });

    useEffect(() => {
        if (isSuccess) {
            setPotentialRecipients(potentialRecipientData)
        }

        if (isError) {
            // eslint-disable-next-line no-console
            console.error("Error fetching recipients");
        }
    }, [isSuccess, isError, potentialRecipientData]);

    useEffect(() => {
        if (messageThreadSuccess && messageThread) {
            router.push(`/app/messages/${messageThread?.id}`);
            close();
            setRecipient(undefined);
        }
        if (messageThreadError) {
            // eslint-disable-next-line no-console
            console.error("Error finding message", messageThreadError);
        }
    }, [messageThreadSuccess, messageThread]);

    return (
        <Modal isIconModal={false} opened={opened} buttonLabel={<span style={{ display: "flex", flexWrap: "nowrap", lineHeight: "1.75em" }}><IconMessagePlus style={{ margin: "0 4px" }} />New Message</span>} buttonProps={{ style: { margin: "8px 0" } }} title="New Message">
            <Stepper
                active={active}
            >
                <Stepper.Step withIcon={false}>
                    <Autocomplete
                        label="Recipient"
                        placeholder="Search for a recipient"
                        data={potentialRecipients.map((recipient) => `${recipient.firstName} ${recipient.lastName}`)}
                        rightSection={isPending ? "Loading..." : null}
                        onChange={(event) => {
                            setRecipientQuery(event);
                            combobox.resetSelectedOption();
                            if (!combobox.dropdownOpened) {
                                combobox.openDropdown();
                            };
                        }}
                        onOptionSubmit={(value) => {
                            const selectedRecipient = potentialRecipients.find((recipient) => `${recipient.firstName} ${recipient.lastName}` === value);
                            if (selectedRecipient) {
                                setRecipient(selectedRecipient);
                            }
                            nextStep();
                        }}

                    />
                </Stepper.Step>
                <Stepper.Step withIcon={false}>
                    {messageThreadSuccess && messageThread ? (
                        <Text>Loading message thread...</Text>
                    ) : (
                        recipient && <ComposeMessage recipient={recipient} />
                    )}
                </Stepper.Step>

            </Stepper>
        </Modal>
    );
}