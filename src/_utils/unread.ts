import type { Page } from "./pagination";

/** The totals behind the Messages badge (`message.getUnreadCount`). */
export type UnreadTotals = { unreadMessages: number; unreadThreads: number };

type ThreadReadState = { hasUnread: boolean; id: string; unreadCount: number };

/** "9", "99+": a badge never grows wider than three characters. */
export function unreadBadgeLabel(count: number): string {
  return count > 99 ? "99+" : String(Math.max(0, count));
}

/** For screen readers: "3 unread messages". */
export function unreadMessagesLabel(count: number): string {
  return `${count} unread ${count === 1 ? "message" : "messages"}`;
}

/** For the navigation: "Messages, 2 unread conversations". */
export function unreadConversationsLabel(count: number): string {
  return `${count} unread ${count === 1 ? "conversation" : "conversations"}`;
}

/**
 * The conversation list after the viewer has read `threadId`: that thread
 * has nothing unread, everything else is untouched (same objects, so
 * nothing else re-renders).
 */
export function markThreadReadInPages<T extends ThreadReadState>(
  pages: ReadonlyArray<Page<T>>,
  threadId: string,
): Array<Page<T>> {
  return pages.map((page) => {
    if (!page.items.some((thread) => thread.id === threadId && (thread.hasUnread || thread.unreadCount > 0))) {
      return page;
    }
    return {
      ...page,
      items: page.items.map((thread) =>
        thread.id === threadId ? { ...thread, hasUnread: false, unreadCount: 0 } : thread,
      ),
    };
  });
}

/** The badge totals after reading a thread that had `unreadCount` unread messages. */
export function totalsAfterRead(totals: UnreadTotals, unreadCount: number): UnreadTotals {
  if (unreadCount <= 0) return totals;
  return {
    unreadMessages: Math.max(0, totals.unreadMessages - unreadCount),
    unreadThreads: Math.max(0, totals.unreadThreads - 1),
  };
}

/**
 * Threads whose preview is out of date after the list was refreshed: new in
 * the list, with more unread than before, or moved up (someone wrote in it,
 * possibly the viewer from another device). One request tells which of the
 * per-thread previews to refetch, instead of polling them all.
 */
export function threadsWithNewActivity(
  previous: ReadonlyArray<{ id: string; unreadCount: number }>,
  current: ReadonlyArray<{ id: string; unreadCount: number }>,
): string[] {
  const before = new Map(previous.map((thread, index) => [thread.id, { index, unreadCount: thread.unreadCount }]));
  return current
    .filter((thread, index) => {
      const was = before.get(thread.id);
      if (!was) return true;
      return thread.unreadCount > was.unreadCount || index < was.index;
    })
    .map((thread) => thread.id);
}
