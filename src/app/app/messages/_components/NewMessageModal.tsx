"use client";

import { Autocomplete, Button, Center, Group, Loader, Modal, Stack, Text } from "@mantine/core";
import { IconMessagePlus } from "@tabler/icons-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar } from "~/app/_components/Avatar";
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
 * "New message" button and composer. `?new=<userId>` in the URL (the
 * "Message" button on profiles) opens it with that user as the recipient.
 * If the two people already have a conversation, that conversation is opened
 * instead of starting a second one.
 */
export default function NewMessageModal() {
    const router = useRouter();
    const pathname = usePathname();
    const utils = api.useUtils();
    const deepLinkUserId = useSearchParams().get("new");

    const [isOpenedByButton, setIsOpenedByButton] = useState(false);
    const [dismissedDeepLink, setDismissedDeepLink] = useState<string | null>(null);
    const [pickedRecipient, setPickedRecipient] = useState<Recipient>();
    const [recipientQuery, setRecipientQuery] = useState("");

    const isDeepLinkActive = !!deepLinkUserId && deepLinkUserId !== dismissedDeepLink;
    const deepLink = api.message.getRecipientById.useQuery(
        { userId: deepLinkUserId ?? "" },
        { enabled: isDeepLinkActive },
    );
    const deepLinkRecipient = isDeepLinkActive ? deepLink.data ?? undefined : undefined;

    const recipient = pickedRecipient ?? deepLinkRecipient;
    const isResolvingDeepLink = isDeepLinkActive && !pickedRecipient && deepLink.isPending;
    const isDeepLinkUnknown = isDeepLinkActive && !pickedRecipient && deepLink.isFetched && !deepLink.data;

    // A deep link to someone the member already talks to opens that
    // conversation. Navigating there drops `?new=`, which closes the composer.
    const deepLinkThread = api.message.getThreadByParticipants.useQuery(
        { participants: [deepLinkUserId ?? ""] },
        { enabled: isDeepLinkActive },
    );
    const deepLinkThreadId = isDeepLinkActive ? deepLinkThread.data?.id : undefined;
    const isCheckingDeepLinkThread = isDeepLinkActive && (deepLinkThread.isPending || !!deepLinkThreadId);
    useEffect(() => {
        if (deepLinkThreadId) router.replace(`/app/messages/${deepLinkThreadId}`);
    }, [deepLinkThreadId, router]);

    const [isCheckingPicked, setIsCheckingPicked] = useState(false);

    const { data: potentialRecipients = [], isFetching: isSearching } = api.message.getPotentialRecipients.useQuery(
        { query: recipientQuery },
        { enabled: recipientQuery.length > 1 },
    );

    const opened = isOpenedByButton || isDeepLinkActive;

    const reset = () => {
        setIsOpenedByButton(false);
        setPickedRecipient(undefined);
        setRecipientQuery("");
        if (deepLinkUserId) setDismissedDeepLink(deepLinkUserId);
    };

    const close = () => {
        reset();
        // Drop ?new= so the composer does not reopen on reload or back.
        if (deepLinkUserId) router.replace(pathname);
    };

    /** Opens a thread: the one just created, or the one that already existed. */
    const openThread = (threadId: string) => {
        reset();
        void utils.message.getThreadsByUserId.invalidate();
        void utils.message.getThreadById.invalidate({ threadId });
        void utils.message.getLatestThreadMessage.invalidate({ threadId });
        router.replace(`/app/messages/${threadId}`);
    };

    /** Picks a recipient, or opens the conversation the two already have. */
    const pickRecipient = async (selected: Recipient) => {
        setIsCheckingPicked(true);
        try {
            const existing = await utils.message.getThreadByParticipants.fetch({ participants: [selected.id] });
            if (existing) {
                openThread(existing.id);
                return;
            }
        } catch {
            // Not being able to check is no reason to block a new message: the
            // server resolves an existing conversation when it is sent.
        } finally {
            setIsCheckingPicked(false);
        }
        setPickedRecipient(selected);
    };

    return (
        <>
            <Button leftSection={<IconMessagePlus size={18} />} size="sm" onClick={() => setIsOpenedByButton(true)}>
                New message
            </Button>
            <Modal opened={opened} onClose={close} title="New message">
                {isResolvingDeepLink || isCheckingDeepLinkThread || isCheckingPicked ? (
                    <Center py="lg"><Loader size="sm" aria-label="Loading" /></Center>
                ) : recipient ? (
                    <Stack gap="sm">
                        <Group justify="space-between" wrap="nowrap">
                            <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                                <Avatar size="md" src={recipient.profilePic} name={fullName(recipient)} alt="" />
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
                        <ComposeMessage recipient={recipient} onThreadCreated={openThread} />
                    </Stack>
                ) : (
                    <Stack gap="sm">
                        {isDeepLinkUnknown && (
                            <Text size="sm" c="red" role="alert">
                                We couldn&apos;t find that person. Search for a recipient instead.
                            </Text>
                        )}
                        <Autocomplete
                            label="Recipient"
                            description="Search by name"
                            placeholder="Start typing a name"
                            data-autofocus
                            data={potentialRecipients.map((r) => ({
                                value: r.id,
                                label: fullName(r),
                            }))}
                            rightSection={isSearching ? <Loader size="xs" /> : null}
                            onChange={setRecipientQuery}
                            onOptionSubmit={(id) => {
                                const selected = potentialRecipients.find((r) => r.id === id);
                                if (selected) void pickRecipient(selected);
                            }}
                        />
                        {recipientQuery.length > 1 && !isSearching && potentialRecipients.length === 0 && (
                            <Text size="sm" c="dimmed" role="status">
                                No one matches &ldquo;{recipientQuery}&rdquo;.
                            </Text>
                        )}
                    </Stack>
                )}
            </Modal>
        </>
    );
}
