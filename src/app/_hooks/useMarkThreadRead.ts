"use client";

import { useEffect, useRef, useState } from "react";

import { THREADS_PAGE_SIZE } from "~/_utils/pageSizes";
import { markThreadReadInPages, totalsAfterRead } from "~/_utils/unread";
import { isLatestMarkReadAttempt, markReadRetryDelayMs } from "~/app/app/messages/_components/markReadRetry";
import { api } from "~/trpc/react";

/**
 * How long the newest message has to be on screen before it counts as read.
 * Also what keeps a burst of incoming messages to one request (the server
 * allows 120 a minute).
 */
export const MARK_READ_DELAY_MS = 800;

/**
 * Marks a thread as read up to `latestMessageId` while it is open AND the
 * tab is visible: when the thread loads, when a message arrives, and when
 * the reader comes back to a tab where one arrived in the meantime. The
 * conversation list and the navigation badge are updated at once; if the
 * server refuses, they are refetched.
 */
export function useMarkThreadRead({
    threadId,
    latestMessageId,
    enabled,
}: {
    threadId: string;
    /** The newest message on screen; nothing is marked while there is none. */
    latestMessageId: string | undefined;
    enabled: boolean;
}) {
    const utils = api.useUtils();
    const { mutate } = api.message.markThreadRead.useMutation();
    const markedUpTo = useRef<string | undefined>(undefined);
    // A failed request is tried again a bounded number of times while the
    // thread stays open (markReadRetryDelayMs); `retry` re-runs the effect.
    const failures = useRef(0);
    const latestAttempt = useRef<string | undefined>(undefined);
    const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        if (!enabled || !latestMessageId || markedUpTo.current === latestMessageId) return;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const markRead = () => {
            if (document.visibilityState !== "visible" || markedUpTo.current === latestMessageId) return;
            markedUpTo.current = latestMessageId;
            latestAttempt.current = latestMessageId;

            // Optimistic: the row loses its unread state and the badge drops now.
            const listInput = { limit: THREADS_PAGE_SIZE };
            const listed = utils.message.getThreadsPage
                .getInfiniteData(listInput)
                ?.pages.flatMap((page) => page.items)
                .find((thread) => thread.id === threadId);
            const unreadBefore = listed?.unreadCount ?? 0;
            utils.message.getThreadsPage.setInfiniteData(listInput, (current) =>
                current ? { ...current, pages: markThreadReadInPages(current.pages, threadId) } : current,
            );
            utils.message.getUnreadCount.setData(undefined, (totals) =>
                totals ? totalsAfterRead(totals, unreadBefore) : totals,
            );

            // `upToMessageId`: only what was on screen is read, so a message
            // that arrives while this request is under way stays unread.
            const input = { threadId, upToMessageId: latestMessageId };
            mutate(input, {
                onError: () => {
                    void utils.message.getThreadsPage.invalidate();
                    void utils.message.getUnreadCount.invalidate();
                    // Only the newest attempt may schedule a retry: an older
                    // request failing late must not disturb it.
                    if (!isLatestMarkReadAttempt(latestAttempt.current, latestMessageId)) return;
                    failures.current += 1;
                    const delay = markReadRetryDelayMs(failures.current);
                    if (delay === null) return;
                    clearTimeout(retryTimer.current);
                    retryTimer.current = setTimeout(() => {
                        if (markedUpTo.current === latestMessageId) markedUpTo.current = undefined;
                        setRetry((count) => count + 1);
                    }, delay);
                },
                // The thread was not in the loaded list (or the list was not
                // loaded): the optimistic step had nothing to go on.
                onSuccess: () => {
                    failures.current = 0;
                    if (!listed) void utils.message.getUnreadCount.invalidate();
                },
            });
        };

        const schedule = () => {
            clearTimeout(timer);
            if (document.visibilityState !== "visible") return;
            timer = setTimeout(markRead, MARK_READ_DELAY_MS);
        };

        schedule();
        document.addEventListener("visibilitychange", schedule);
        return () => {
            clearTimeout(timer);
            document.removeEventListener("visibilitychange", schedule);
        };
    }, [enabled, latestMessageId, mutate, retry, threadId, utils]);

    // Leaving the thread ends any pending retry.
    useEffect(() => () => clearTimeout(retryTimer.current), [threadId]);
}
