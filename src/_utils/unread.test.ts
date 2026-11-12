import { describe, expect, it } from "vitest";

import {
  markThreadReadInPages,
  threadsWithNewActivity,
  totalsAfterRead,
  unreadBadgeLabel,
  unreadConversationsLabel,
  unreadMessagesLabel,
} from "./unread";

const thread = (id: string, unreadCount = 0) => ({ hasUnread: unreadCount > 0, id, unreadCount });

describe("unread labels", () => {
  it("caps the badge at 99+", () => {
    expect(unreadBadgeLabel(1)).toBe("1");
    expect(unreadBadgeLabel(99)).toBe("99");
    expect(unreadBadgeLabel(100)).toBe("99+");
    expect(unreadBadgeLabel(-2)).toBe("0");
  });

  it("uses the singular for one", () => {
    expect(unreadMessagesLabel(1)).toBe("1 unread message");
    expect(unreadMessagesLabel(4)).toBe("4 unread messages");
    expect(unreadConversationsLabel(1)).toBe("1 unread conversation");
    expect(unreadConversationsLabel(2)).toBe("2 unread conversations");
  });
});

describe("markThreadReadInPages", () => {
  const pages = [
    { items: [thread("a", 3), thread("b")], nextCursor: "b" },
    { items: [thread("c", 1)], nextCursor: null },
  ];

  it("clears the unread state of the thread that was read, on whichever page it is", () => {
    const result = markThreadReadInPages(pages, "c");
    expect(result[1]?.items[0]).toEqual({ hasUnread: false, id: "c", unreadCount: 0 });
    expect(result[1]?.nextCursor).toBeNull();
  });

  it("leaves every other thread and page exactly as it was", () => {
    const result = markThreadReadInPages(pages, "c");
    expect(result[0]).toBe(pages[0]);
    expect(markThreadReadInPages(pages, "a")[0]?.items[1]).toBe(pages[0]?.items[1]);
  });

  it("changes nothing for a thread that has nothing unread or is not listed", () => {
    expect(markThreadReadInPages(pages, "b")).toEqual(pages);
    expect(markThreadReadInPages(pages, "zzz").every((page, index) => page === pages[index])).toBe(true);
  });
});

describe("totalsAfterRead", () => {
  it("takes the thread and its messages off the totals", () => {
    expect(totalsAfterRead({ unreadMessages: 5, unreadThreads: 2 }, 3)).toEqual({ unreadMessages: 2, unreadThreads: 1 });
  });

  it("never goes below zero", () => {
    expect(totalsAfterRead({ unreadMessages: 1, unreadThreads: 0 }, 4)).toEqual({ unreadMessages: 0, unreadThreads: 0 });
  });

  it("is unchanged when the thread had nothing unread", () => {
    const totals = { unreadMessages: 5, unreadThreads: 2 };
    expect(totalsAfterRead(totals, 0)).toBe(totals);
  });
});

describe("threadsWithNewActivity", () => {
  const before = [thread("a"), thread("b", 1), thread("c")];

  it("is empty when nothing changed", () => {
    expect(threadsWithNewActivity(before, before)).toEqual([]);
  });

  it("names a thread that gained unread messages", () => {
    expect(threadsWithNewActivity(before, [thread("a"), thread("b", 2), thread("c")])).toEqual(["b"]);
  });

  it("names a thread that moved up and a thread that is new", () => {
    expect(threadsWithNewActivity(before, [thread("c"), thread("a"), thread("b", 1), thread("d")])).toEqual(["c", "d"]);
  });

  it("ignores a thread that was read, and one that left the list", () => {
    expect(threadsWithNewActivity(before, [thread("a"), thread("b", 0), thread("c")])).toEqual([]);
    expect(threadsWithNewActivity(before, [thread("a"), thread("b", 1)])).toEqual([]);
  });
});
