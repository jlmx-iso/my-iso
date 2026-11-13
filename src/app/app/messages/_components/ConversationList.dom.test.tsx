// @vitest-environment happy-dom
//
// The conversation list: most recent first, the other person's name and the
// latest message (prefixed "You: " when it is the viewer's), unread counts
// (never on the open conversation), the empty state, older pages, and how
// it keeps up: the list is polled, only the previews of conversations with
// new activity are refetched, and a preview follows its cache entry, which
// the open thread updates as messages arrive over the socket.

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getQueryKey } from "@trpc/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import { api, type RouterOutputs } from "~/trpc/react";

import ConversationList, { type ConversationSummary } from "./ConversationList";

type Thread = RouterOutputs["message"]["getThreadsPage"]["items"][number];
type Latest = NonNullable<RouterOutputs["message"]["getLatestThreadMessage"]>;
type MessageHandlers = NonNullable<TrpcHandlers["message"]>;

const ME = { firstName: "Me", id: "me", lastName: "Self", photographer: null, profilePic: null };

function person(id: string, firstName: string, lastName: string) {
  return { firstName, id, lastName, photographer: null, profilePic: null };
}

const BEA = person("bea", "Bea", "Cole");
const CAL = person("cal", "Cal", "Diaz");
const DEE = person("dee", "Dee", "Park");

function thread(id: string, other: ReturnType<typeof person>, unreadCount = 0): Thread {
  return { hasUnread: unreadCount > 0, id, participants: [other, ME], unreadCount };
}

function latest(id: string, content: string, minutesAgo: number, sender: { firstName: string; id: string; lastName: string } = BEA): Latest {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  return { content, createdAt: at, id, sender: { ...sender, profilePic: null }, updatedAt: at };
}

function summary(t: Thread, lastMessage: Latest | null): ConversationSummary {
  return { ...t, lastMessage };
}

function renderList(
  initialThreads: ConversationSummary[],
  handlers: MessageHandlers = {},
  options: { nextCursor?: string | null; selected?: string | null } = {},
) {
  return renderWithProviders(
    <ConversationList
      initialThreads={initialThreads}
      initialNextCursor={options.nextCursor ?? null}
      currentUserId="me"
      selectedThreadId={options.selected ?? null}
    />,
    {
      trpc: {
        message: {
          getLatestThreadMessage: () => null,
          getThreadsPage: () => ({ items: initialThreads.map(({ lastMessage: _drop, ...t }) => t), nextCursor: options.nextCursor ?? null }),
          ...handlers,
        },
      },
    },
  );
}

const rows = () => screen.getAllByTestId("conversation-row");
const names = () => rows().map((row) => row.querySelector("p")?.textContent);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ConversationList", () => {
  it("lists conversations by their latest message, naming the other person", () => {
    renderList([
      summary(thread("t1", BEA), latest("m1", "See you Saturday", 60)),
      summary(thread("t2", CAL), latest("m2", "Sounds good", 5, ME)),
      summary(thread("t3", DEE), null),
    ]);

    expect(names()).toEqual(["Cal Diaz", "Bea Cole", "Dee Park"]);
    const [cal, bea, dee] = rows();
    expect(cal!.getAttribute("href")).toBe("/app/messages/t2");
    expect(within(cal!).getByText("You: Sounds good")).toBeTruthy();
    expect(within(bea!).getByText("See you Saturday")).toBeTruthy();
    expect(within(dee!).getByText("No messages yet")).toBeTruthy();
    // Previews are member writing: kept out of session replay.
    expect(within(bea!).getByText("See you Saturday").hasAttribute("data-replay-block")).toBe(true);
  });

  it("shows unread counts, but never on the open conversation", () => {
    renderList(
      [
        summary(thread("t1", BEA, 3), latest("m1", "Hello?", 1)),
        summary(thread("t2", CAL, 120), latest("m2", "Lots", 2)),
        summary(thread("t3", DEE, 2), latest("m3", "Open one", 3)),
      ],
      {},
      { selected: "t3" },
    );

    const [bea, cal, dee] = rows();
    expect(bea!.getAttribute("data-unread")).toBe("true");
    expect(within(bea!).getByTestId("conversation-unread").textContent).toBe("33 unread messages");
    expect(within(cal!).getByTestId("conversation-unread").textContent).toBe("99+120 unread messages");
    expect(dee!.getAttribute("aria-current")).toBe("page");
    expect(dee!.hasAttribute("data-unread")).toBe(false);
    expect(within(dee!).queryByTestId("conversation-unread")).toBeNull();
  });

  it("explains how to start a conversation when there is none", () => {
    renderList([]);
    expect(screen.getByText("No conversations yet")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("polls the list and refetches the previews of only the conversations with something new", async () => {
    const initial = [
      summary(thread("t1", BEA), latest("m1", "Old news", 60)),
      summary(thread("t2", CAL), latest("m2", "Quiet", 30)),
    ];
    let polled = false;
    const view = renderList(initial, {
      getLatestThreadMessage: ({ threadId }) =>
        threadId === "t1" ? latest("m9", "Fresh news", 0) : latest("m10", "New here", 1, DEE),
      getThreadsPage: () => ({
        items: polled ? [thread("t1", BEA, 1), thread("t2", CAL), thread("t4", DEE, 1)] : [thread("t1", BEA), thread("t2", CAL)],
        nextCursor: null,
      }),
    });
    await waitFor(() => expect(view.callsTo("message.getThreadsPage")).toHaveLength(1));
    expect(view.callsTo("message.getLatestThreadMessage")).toEqual([]);

    polled = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(await screen.findByText("Fresh news")).toBeTruthy();
    expect(await screen.findByText("New here")).toBeTruthy();
    expect(view.callsTo("message.getThreadsPage")).toHaveLength(2);
    // t1 has new unread messages, t4 is new; t2 is untouched and not asked for.
    const asked = view.callsTo("message.getLatestThreadMessage") as Array<{ threadId: string }>;
    expect(asked.map((input) => input.threadId).sort()).toEqual(["t1", "t4"]);
    expect(names()).toEqual(["Bea Cole", "Dee Park", "Cal Diaz"]);
    expect(within(rows()[0]!).getByTestId("conversation-unread").textContent).toBe("11 unread message");
  });

  it("follows a preview's cache entry, as the open thread updates it on a realtime message", async () => {
    const view = renderList([
      summary(thread("t1", BEA), latest("m1", "First", 60)),
      summary(thread("t2", CAL), latest("m2", "Second", 30)),
    ]);
    expect(names()).toEqual(["Cal Diaz", "Bea Cole"]);

    act(() => {
      view.queryClient.setQueryData(
        getQueryKey(api.message.getLatestThreadMessage, { threadId: "t1" }, "query"),
        latest("m3", "Just arrived", 0),
      );
    });

    expect(await screen.findByText("Just arrived")).toBeTruthy();
    expect(names()).toEqual(["Bea Cole", "Cal Diaz"]);
    expect(view.callsTo("message.getLatestThreadMessage")).toEqual([]);
  });

  it("loads older conversations with the cursor, and says when that fails", async () => {
    let failNext = false;
    const view = renderList([summary(thread("t1", BEA), latest("m1", "Recent", 1))], {
      getLatestThreadMessage: () => latest("m0", "Long ago", 60 * 24 * 30, CAL),
      getThreadsPage: (input) => {
        if (!input?.cursor) return { items: [thread("t1", BEA)], nextCursor: "t1" };
        if (failNext) throw trpcError("INTERNAL_SERVER_ERROR", "Internal error");
        return { items: [thread("t0", CAL)], nextCursor: "t0" };
      },
    }, { nextCursor: "t1" });

    await userEvent.click(screen.getByRole("button", { name: "Load older conversations" }));

    expect(await screen.findByText("Long ago")).toBeTruthy();
    expect(names()).toEqual(["Bea Cole", "Cal Diaz"]);
    expect(view.callsTo("message.getThreadsPage")).toContainEqual({ cursor: "t1", direction: "forward", limit: 25 });

    failNext = true;
    await userEvent.click(screen.getByRole("button", { name: "Load older conversations" }));
    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't load more conversations. Please try again.");
  });
});
