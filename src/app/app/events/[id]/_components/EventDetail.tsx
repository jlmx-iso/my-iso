"use client";

import { Alert, Anchor, Badge, Box, Button, Divider, Group, Skeleton, Stack, Text, Title } from "@mantine/core";
import { IconAlertCircle, IconArrowLeft } from "@tabler/icons-react";
import Link from "next/link";

import { COMMENTS_PAGE_SIZE } from "~/_utils/pageSizes";
import { mergePagesOldestFirst, partialCountNote } from "~/_utils/pagination";
import AddCommentForm from "~/app/_components/AddCommentForm";
import ApplyAction from "~/app/_components/events/ApplyAction";
import EventComment from "~/app/_components/events/EventComment";
import EventCover from "~/app/_components/events/EventCover";
import EventMeta from "~/app/_components/events/EventMeta";
import { useFocusNewItems } from "~/app/_hooks/useFocusNewItems";
import { useNow } from "~/app/_hooks/useNow";
import { type RouterOutputs, api } from "~/trpc/react";

import EventOwnerCard from "./EventOwnerCard";

type EventDetailProps = {
    /** The event as the server rendered it; kept fresh by the query below. */
    initialEvent: RouterOutputs["event"]["getById"];
    currentUserId: string | null;
    /** "Message" for the poster, rendered on the server; absent for the owner. */
    messageAction?: React.ReactNode;
};

/** The server just rendered this data: no need to ask again on mount. */
const FRESH_FOR_MS = 30_000;

/** One event: what, where and when, the way to apply, then its comments. */
export default function EventDetail({ initialEvent, currentUserId, messageAction }: EventDetailProps) {
    const eventId = initialEvent.id;
    const { data: event } = api.event.getById.useQuery(
        { id: eventId },
        { initialData: initialEvent, staleTime: FRESH_FOR_MS },
    );
    const isOwnEvent = event.photographer.userId === currentUserId;
    const applied = api.booking.hasApplied.useQuery({ eventId }, { enabled: !isOwnEvent });
    const application = applied.data;
    const now = useNow();
    const isPast = new Date(event.date).getTime() < now.getTime();

    // The newest comments first; "Load earlier comments" pages back in time.
    const comments = api.event.getCommentsPage.useInfiniteQuery(
        { eventId, limit: COMMENTS_PAGE_SIZE },
        { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
    );
    const total = api.event.getCommentCountByEventId.useQuery({ eventId }, { initialData: initialEvent.commentCount, staleTime: FRESH_FOR_MS });
    const loaded = mergePagesOldestFirst(comments.data?.pages);
    // Earlier comments appear above the ones on screen.
    const { expectMore, listRef } = useFocusNewItems(loaded.length, "start");
    // The heading shows the real total, never just what happens to be loaded.
    const commentCount = Math.max(total.data ?? 0, loaded.length);
    const partialNote = comments.hasNextPage
        ? partialCountNote(loaded.length, commentCount, { one: "comment", other: "comments" })
        : null;

    return (
        <Stack gap="md" maw={760} mx="auto">
            <Anchor component={Link} href="/app/events" c="dimmed" size="sm" w="fit-content" className="tap-link">
                <Group gap={4} wrap="nowrap"><IconArrowLeft size={14} aria-hidden /> Back to events</Group>
            </Anchor>

            <Stack gap="md" component="article">
                <Stack gap="xs">
                    {isPast && <Badge variant="light" color="gray" w="fit-content">Past event</Badge>}
                    <Title order={1} size="h2" style={{ overflowWrap: "anywhere" }}>{event.title}</Title>
                    <EventMeta
                        date={event.date}
                        timeZone={event.timeZone}
                        duration={event.duration}
                        location={event.location}
                        payCents={event.payCents}
                    />
                </Stack>

                {/* The page's primary action: above the description and the
                    cover, so it is on screen without scrolling on a phone. */}
                <Box data-testid="event-primary-action">
                    <ApplyAction event={event} application={application} isOwnEvent={isOwnEvent} prominent />
                </Box>

                {event.description && (
                    <Text maw={680} style={{ lineHeight: 1.6, whiteSpace: "pre-line" }}>
                        {event.description}
                    </Text>
                )}

                {event.image && <EventCover src={event.image} mah={420} radius="md" />}

                <EventOwnerCard event={event} isOwner={isOwnEvent} messageAction={messageAction} />
            </Stack>

            <Divider />

            <Stack gap="xs" component="section" aria-labelledby="comments-heading">
                <Title order={2} size="h5" id="comments-heading">
                    Comments{commentCount ? ` (${commentCount})` : ""}
                </Title>

                {comments.isPending ? (
                    <Stack gap="sm" aria-busy="true" aria-label="Loading comments">
                        <Skeleton height={56} radius="md" />
                        <Skeleton height={56} radius="md" />
                    </Stack>
                ) : comments.isError ? (
                    <Alert color="red" icon={<IconAlertCircle size={16} />} title="We couldn't load comments">
                        <Button variant="default" size="xs" mt="xs" onClick={() => void comments.refetch()}>
                            Try again
                        </Button>
                    </Alert>
                ) : loaded.length === 0 ? (
                    <Text c="dimmed" size="sm">No comments yet. Ask a question or say you&apos;re interested.</Text>
                ) : (
                    <>
                        {comments.hasNextPage && (
                            <Group justify="space-between" align="center" gap="sm">
                                <Text size="sm" c="dimmed" role="status" data-testid="comments-partial">
                                    {partialNote ?? `Showing the latest ${loaded.length} comments`}
                                </Text>
                                <Button
                                    variant="default"
                                    size="xs"
                                    className="touch-target"
                                    onClick={() => {
                                        expectMore();
                                        void comments.fetchNextPage();
                                    }}
                                    loading={comments.isFetchingNextPage}
                                >
                                    Load earlier comments
                                </Button>
                            </Group>
                        )}
                        {comments.isFetchNextPageError && (
                            <Text size="sm" c="red" role="alert">
                                We couldn&apos;t load earlier comments. Please try again.
                            </Text>
                        )}
                        <Stack ref={listRef} gap={0} component="ul" m={0} p={0} aria-label="Comments">
                            {loaded.map((comment) => (
                                <EventComment key={comment.id} comment={comment} />
                            ))}
                        </Stack>
                    </>
                )}

                <AddCommentForm eventId={eventId} eventTitle={event.title} />
            </Stack>
        </Stack>
    );
}
