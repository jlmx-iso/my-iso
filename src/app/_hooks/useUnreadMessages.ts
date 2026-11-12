"use client";

import { api } from "~/trpc/react";

/** How often the navigation asks whether there is anything new. */
const UNREAD_POLL_MS = 30_000;

/** Conversations with something new, for the Messages badge. 0 while unknown. */
export function useUnreadConversations(enabled = true): number {
    const { data } = api.message.getUnreadCount.useQuery(undefined, {
        enabled,
        refetchInterval: UNREAD_POLL_MS,
        refetchIntervalInBackground: false,
    });
    return data?.unreadThreads ?? 0;
}
