"use client";

import { Anchor, Autocomplete, Button, Center, Group, Loader, Modal, Stack, Text, ThemeIcon } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconMessagePlus, IconUserSearch, IconUsers } from "@tabler/icons-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ErrorReason, getErrorReason } from "~/_utils/errorReason";
import { fullName } from "~/_utils/names";
import { NOT_MESSAGEABLE_MESSAGE, userFacingError } from "~/_utils/userError";
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

/** The search starts at this many characters. */
const MIN_QUERY_LENGTH = 2;

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
        // The server answers 403 for someone who cannot be messaged: asking
        // again would not change that.
        { enabled: isDeepLinkActive, retry: false },
    );
    const deepLinkRecipient = isDeepLinkActive ? deepLink.data ?? undefined : undefined;

    const recipient = pickedRecipient ?? deepLinkRecipient;
    const isResolvingDeepLink = isDeepLinkActive && !pickedRecipient && deepLink.isPending;
    const isDeepLinkUnknown = isDeepLinkActive && !pickedRecipient && deepLink.isFetched && !deepLink.data;
    const isDeepLinkNotMessageable =
        isDeepLinkUnknown && getErrorReason(deepLink.error) === ErrorReason.RECIPIENT_NOT_MESSAGEABLE;

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

    // One search per pause in typing, not one per keystroke (searches are rate limited).
    const [debouncedQuery] = useDebouncedValue(recipientQuery.trim(), 250);
    const isSearchEnabled = debouncedQuery.length >= MIN_QUERY_LENGTH;
    const {
        data: potentialRecipients = [],
        error: searchError,
        isFetching: isSearching,
        isSuccess: hasSearched,
    } = api.message.getPotentialRecipients.useQuery(
        { query: debouncedQuery },
        { enabled: isSearchEnabled },
    );
    const hasNoMatches = isSearchEnabled && hasSearched && !isSearching && potentialRecipients.length === 0;

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
        void utils.message.getThreadsPage.invalidate();
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
                                {isDeepLinkNotMessageable
                                    ? NOT_MESSAGEABLE_MESSAGE
                                    : "We couldn't find that person. Search for someone else instead."}
                            </Text>
                        )}
                        <Autocomplete
                            label="Recipient"
                            description="Search by name or business name"
                            placeholder="Start typing a name"
                            error={searchError
                                // Typing fast can run into the search limit: say how long to wait.
                                ? userFacingError(searchError, "We couldn't search right now. Please try again.")
                                : undefined}
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
                        {/* Always rendered so screen readers hear the outcome of a search. */}
                        <div role="status">
                            {hasNoMatches ? (
                                <Stack align="center" gap={6} py="md" data-testid="recipient-empty">
                                    <ThemeIcon size={44} radius="xl" variant="light" color="gray">
                                        <IconUserSearch size={22} aria-hidden />
                                    </ThemeIcon>
                                    <Text fw={600} size="sm" ta="center">
                                        No one to message matches &ldquo;{debouncedQuery}&rdquo;
                                    </Text>
                                    <Text size="sm" c="dimmed" ta="center" maw={340}>
                                        You can start a conversation with photographers who are visible in
                                        Discover, and with anyone you&apos;ve matched or booked with. To reach
                                        someone else, match with them on{" "}
                                        <Anchor component={Link} href="/app/discover" inherit underline="always">Discover</Anchor>{" "}
                                        or apply to one of their{" "}
                                        <Anchor component={Link} href="/app/events" inherit underline="always">events</Anchor>.
                                    </Text>
                                </Stack>
                            ) : !isSearchEnabled && !searchError ? (
                                <Group gap="xs" wrap="nowrap" align="flex-start" py={4}>
                                    <IconUsers size={16} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
                                    <Text size="sm" c="dimmed">
                                        You can message photographers who are visible in Discover, and anyone
                                        you&apos;ve matched or booked with.
                                    </Text>
                                </Group>
                            ) : null}
                        </div>
                    </Stack>
                )}
            </Modal>
        </>
    );
}
