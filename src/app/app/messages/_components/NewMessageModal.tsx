"use client";

import { Autocomplete, Button, Center, Group, Loader, Stack, Text } from "@mantine/core";
import { IconMessagePlus } from "@tabler/icons-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { ErrorReason, getErrorReason } from "~/_utils";
import { Avatar } from "~/app/_components/Avatar";
import { Modal } from "~/app/_components/Modal";
import { api } from "~/trpc/react";

import ComposeMessage from "./ComposeMessage";

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

const fullName = (recipient: Recipient) => `${recipient.firstName} ${recipient.lastName}`.trim();

/**
 * "New Message" button and composer. `?new=<userId>` in the URL (the
 * "Message" button on profiles) opens it with that user as the recipient.
 */
export default function NewMessageModal() {
    const router = useRouter();
    const pathname = usePathname();
    const deepLinkUserId = useSearchParams().get("new");

    const [isOpenedByButton, setIsOpenedByButton] = useState(false);
    const [dismissedDeepLink, setDismissedDeepLink] = useState<string | null>(null);
    const [pickedRecipient, setPickedRecipient] = useState<Recipient>();
    const [recipientQuery, setRecipientQuery] = useState("");

    const isDeepLinkActive = !!deepLinkUserId && deepLinkUserId !== dismissedDeepLink;
    const deepLink = api.message.getRecipientById.useQuery(
        { userId: deepLinkUserId ?? "" },
        // A refusal is an answer, not a failure to retry.
        { enabled: isDeepLinkActive, retry: false },
    );
    const deepLinkRecipient = isDeepLinkActive ? deepLink.data ?? undefined : undefined;

    const recipient = pickedRecipient ?? deepLinkRecipient;
    const isResolvingDeepLink = isDeepLinkActive && !pickedRecipient && deepLink.isPending;
    const isDeepLinkUnknown = isDeepLinkActive && !pickedRecipient && deepLink.isFetched && !deepLink.data;
    const isDeepLinkNotMessageable =
        isDeepLinkUnknown && getErrorReason(deepLink.error) === ErrorReason.RECIPIENT_NOT_MESSAGEABLE;

    const isSearchEnabled = recipientQuery.length > 1;
    const { data: potentialRecipients = [], isFetching: isSearching, isSuccess: hasSearched } = api.message.getPotentialRecipients.useQuery(
        { query: recipientQuery },
        { enabled: isSearchEnabled },
    );
    const hasNoEligibleRecipients = isSearchEnabled && hasSearched && !isSearching && potentialRecipients.length === 0;

    const close = () => {
        setIsOpenedByButton(false);
        setPickedRecipient(undefined);
        setRecipientQuery("");
        if (deepLinkUserId) {
            // Drop ?new= so the composer does not reopen on reload or back.
            setDismissedDeepLink(deepLinkUserId);
            router.replace(pathname);
        }
    };

    const onThreadCreated = (threadId: string) => {
        close();
        router.push(`/app/messages/${threadId}`);
        // The conversation list is rendered by the server layout.
        router.refresh();
    };

    return (
        <Modal
            isIconModal={false}
            opened={isOpenedByButton || isDeepLinkActive}
            onOpen={() => setIsOpenedByButton(true)}
            onClose={close}
            buttonLabel="New Message"
            buttonProps={{ leftSection: <IconMessagePlus size={18} />, size: "sm" }}
            title="New Message"
        >
            {isResolvingDeepLink ? (
                <Center py="lg"><Loader size="sm" aria-label="Loading recipient" /></Center>
            ) : recipient ? (
                <Stack gap="sm">
                    <Group justify="space-between" wrap="nowrap">
                        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                            <Avatar size="md" src={recipient.profilePic} name={fullName(recipient)} />
                            <Stack gap={0} style={{ minWidth: 0 }}>
                                <Text size="xs" c="dimmed">To</Text>
                                <Text fw={600} size="sm" truncate>{fullName(recipient)}</Text>
                                {recipient.photographer && (
                                    <Text size="xs" c="dimmed" truncate>{recipient.photographer.companyName}</Text>
                                )}
                            </Stack>
                        </Group>
                        <Button
                            variant="subtle"
                            size="compact-sm"
                            onClick={() => {
                                setPickedRecipient(undefined);
                                if (deepLinkUserId) setDismissedDeepLink(deepLinkUserId);
                                setIsOpenedByButton(true);
                            }}
                        >
                            Change
                        </Button>
                    </Group>
                    <ComposeMessage recipient={recipient} onThreadCreated={onThreadCreated} />
                </Stack>
            ) : (
                <Stack gap="sm">
                    {isDeepLinkUnknown && (
                        <Text size="sm" c="red" role="alert">
                            {isDeepLinkNotMessageable
                                ? "This photographer isn't accepting new messages. To connect, match with them on Discover or apply to one of their events."
                                : "We couldn't find that person. Search for a recipient instead."}
                        </Text>
                    )}
                    <Autocomplete
                        label="Recipient"
                        placeholder="Search for a recipient"
                        data-autofocus
                        data={potentialRecipients.map((r) => ({
                            value: r.id,
                            label: fullName(r),
                        }))}
                        rightSection={isSearching ? <Loader size="xs" /> : null}
                        onChange={setRecipientQuery}
                        onOptionSubmit={(id) => {
                            const selected = potentialRecipients.find((r) => r.id === id);
                            if (selected) setPickedRecipient(selected);
                        }}
                    />
                    {hasNoEligibleRecipients && (
                        <Text size="sm" c="dimmed" role="status">
                            No eligible recipients found. You can message photographers who are discoverable, or people you have matched or booked with.
                        </Text>
                    )}
                </Stack>
            )}
        </Modal>
    );
}
