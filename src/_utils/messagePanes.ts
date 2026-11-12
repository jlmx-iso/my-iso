/**
 * Which pane of the messages screen a URL selects.
 *
 * The messages layout wraps both `/app/messages` and `/app/messages/[id]`, and
 * a layout never receives the params of its child segments. The selected
 * child segment (from `useSelectedLayoutSegment`) is what tells them apart:
 * `null` on the list route, the thread id on a thread route.
 *
 * Wide screens show both panes side by side whatever this returns; below the
 * `md` breakpoint only the active pane is shown.
 */
export type MessagePane = "list" | "thread";

export function activeMessagePane(selectedSegment: string | null): MessagePane {
  return selectedSegment ? "thread" : "list";
}

/** The thread id a selected layout segment refers to, if any. */
export function selectedThreadId(selectedSegment: string | null): string | null {
  return selectedSegment ? decodeURIComponent(selectedSegment) : null;
}

type ThreadWithLatest = {
  id: string;
  lastMessage: { createdAt: Date } | null;
};

/**
 * Conversation list order: most recent message first. Threads without any
 * message (should not happen, but the data allows it) go last, in their given
 * order.
 */
export function sortThreadsByRecency<T extends ThreadWithLatest>(threads: readonly T[]): T[] {
  return threads
    .map((thread, index) => ({ index, thread }))
    .sort((a, b) => {
      const aTime = a.thread.lastMessage?.createdAt.getTime() ?? -Infinity;
      const bTime = b.thread.lastMessage?.createdAt.getTime() ?? -Infinity;
      return bTime - aTime || a.index - b.index;
    })
    .map(({ thread }) => thread);
}

/**
 * Where `/app/messages` should send a wide-screen visitor: the most recent
 * thread, so the second pane is never empty. Phones stay on the list, and a
 * `?new=` deep link (composer open) is left alone.
 */
export function defaultThreadRedirect({
  isWideScreen,
  hasNewMessageDeepLink,
  selectedSegment,
  threads,
}: {
  isWideScreen: boolean;
  hasNewMessageDeepLink: boolean;
  selectedSegment: string | null;
  threads: readonly ThreadWithLatest[];
}): string | null {
  if (!isWideScreen || hasNewMessageDeepLink || selectedSegment) return null;
  const latest = sortThreadsByRecency(threads)[0];
  return latest ? `/app/messages/${latest.id}` : null;
}
