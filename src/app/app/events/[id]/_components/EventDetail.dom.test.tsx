// @vitest-environment happy-dom
//
// An event's page: what, where and when (with a "Past event" badge once it
// has started), the viewer's way to apply (or "Your event" for the owner,
// who is not asked about their own application), and the comments: the
// latest page first, the real total in the heading, earlier pages loaded
// above, and the loading, empty and error states.

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import type { RouterOutputs } from "~/trpc/react";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));

import EventDetail from "./EventDetail";

type Event = RouterOutputs["event"]["getById"];
type Comment = RouterOutputs["event"]["getCommentsPage"]["items"][number];
type EventHandlers = NonNullable<TrpcHandlers["event"]>;

const DAY = 24 * 60 * 60 * 1000;

function event(overrides: Record<string, unknown> = {}): Event {
  return {
    commentCount: 0,
    createdAt: new Date(Date.now() - 10 * DAY),
    date: new Date(Date.now() + 30 * DAY),
    description: "Ceremony and portraits",
    duration: 6,
    id: "ev-1",
    image: null,
    location: "Austin, TX",
    payCents: 60_000,
    photographer: { avatar: null, isPro: false, name: "Marcus Rivera", userId: "marcus" },
    timeZone: null,
    title: "Spring wedding",
    ...overrides,
  } as unknown as Event;
}

const comments = new Map<string, Comment>();

function comment(id: string, content: string): Comment {
  const made = {
    commentLikes: 0,
    content,
    createdAt: new Date(Date.now() - DAY),
    id,
    isLiked: false,
    user: { firstName: "Bea", id: "bea", lastName: "Cole", profilePic: null },
    userId: "bea",
  } as unknown as Comment;
  comments.set(id, made);
  return made;
}

function renderDetail(initial: Event, currentUserId: string, handlers: EventHandlers = {}) {
  return renderWithProviders(<EventDetail initialEvent={initial} currentUserId={currentUserId} />, {
    trpc: {
      booking: { hasApplied: () => ({ applyBlockedBy: null, canReapply: false, hasApplied: false, status: null }) },
      event: {
        getCommentById: ({ id }) => comments.get(id) as never,
        getCommentCountByEventId: () => initial.commentCount,
        getCommentsPage: () => ({ items: [], nextCursor: null }),
        ...handlers,
      },
    },
  });
}

const commentsSection = () => screen.getByRole("region", { name: /^Comments/ });

describe("EventDetail", () => {
  it("shows the event and offers to apply, with no comments yet", async () => {
    const view = renderDetail(event(), "ann");

    expect(screen.getByRole("heading", { level: 1, name: "Spring wedding" })).toBeTruthy();
    expect(screen.getByText("Ceremony and portraits")).toBeTruthy();
    expect(screen.queryByText("Past event")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to events" }).getAttribute("href")).toBe("/app/events");
    expect(within(commentsSection()).getByLabelText("Loading comments")).toBeTruthy();

    expect(await within(screen.getByTestId("event-primary-action")).findByRole("button", { name: /Apply/ })).toBeTruthy();
    expect(await screen.findByText("No comments yet. Ask a question or say you're interested.")).toBeTruthy();
    expect(view.callsTo("booking.hasApplied")).toEqual([{ eventId: "ev-1" }]);
    expect(view.callsTo("event.getCommentsPage")).toEqual([{ direction: "forward", eventId: "ev-1", limit: 20 }]);
    expect(screen.getByRole("textbox", { name: "Comment on Spring wedding" })).toBeTruthy();
  });

  it("does not ask the owner about their own application, and marks a past event", async () => {
    const view = renderDetail(event({ date: new Date(Date.now() - DAY), description: null }), "marcus");
    expect(screen.getByText("Past event")).toBeTruthy();
    expect(within(screen.getByTestId("event-primary-action")).getByText("Your event")).toBeTruthy();
    await screen.findByText(/No comments yet/);
    expect(view.callsTo("booking.hasApplied")).toEqual([]);
  });

  it("titles the comments with the real total and loads earlier ones above", async () => {
    const view = renderDetail(event({ commentCount: 3 }), "ann", {
      getCommentsPage: (input) =>
        input.cursor
          ? { items: [comment("c1", "First!")], nextCursor: null }
          : { items: [comment("c2", "Second"), comment("c3", "Third")], nextCursor: "c2" },
    });

    expect(await within(commentsSection()).findByText("Third")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Comments (3)" })).toBeTruthy();
    expect(screen.getByTestId("comments-partial").textContent).toBe("Showing 2 of 3 comments");

    await userEvent.click(screen.getByRole("button", { name: "Load earlier comments" }));

    expect(await screen.findByText("First!")).toBeTruthy();
    const list = within(screen.getByRole("list", { name: "Comments" }));
    expect(list.getAllByRole("listitem").map((item) => item.textContent?.match(/First!|Second|Third/)?.[0])).toEqual([
      "First!",
      "Second",
      "Third",
    ]);
    expect(view.callsTo("event.getCommentsPage")).toContainEqual({ cursor: "c2", direction: "forward", eventId: "ev-1", limit: 20 });
    expect(screen.queryByTestId("comments-partial")).toBeNull();
  });

  it("says how many are shown when the total is not known yet", async () => {
    renderDetail(event({ commentCount: 0 }), "ann", {
      getCommentCountByEventId: () => 0,
      getCommentsPage: () => ({ items: [comment("c2", "Second")], nextCursor: "c2" }),
    });

    expect(await screen.findByText("Showing the latest 1 comments")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Comments (1)" })).toBeTruthy();
  });

  it("offers a retry when the comments cannot be loaded", async () => {
    let calls = 0;
    renderDetail(event(), "ann", {
      getCommentsPage: () => {
        calls += 1;
        if (calls === 1) throw trpcError("INTERNAL_SERVER_ERROR", "Internal error");
        return { items: [comment("c1", "Hello")], nextCursor: null };
      },
    });

    expect(await screen.findByText("We couldn't load comments")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Hello")).toBeTruthy();
  });
});
