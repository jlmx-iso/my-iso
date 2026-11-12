// @vitest-environment happy-dom
//
// The events feed: the server-rendered first page with each card's apply
// state from one applications request (or per card when that fails), page
// by page loading with its failure said under the button, a stale cursor
// starting the list again, the Past tab, and empty and error states.

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";

import EventsFeed from "./EventsFeed";

type FeedPage = Awaited<ReturnType<NonNullable<NonNullable<TrpcHandlers["event"]>["getFeedPage"]>>>;
type Applications = Awaited<ReturnType<NonNullable<NonNullable<TrpcHandlers["booking"]>["getMyApplications"]>>>;

const DAY = 24 * 60 * 60 * 1000;
const ME = "me";

function event(id: string, title: string, options: { daysAhead?: number; owner?: string } = {}) {
  const owner = options.owner ?? "ann";
  return {
    commentCount: 0,
    createdAt: new Date(Date.now() - DAY),
    date: new Date(Date.now() + (options.daysAhead ?? 3) * DAY),
    description: `${title} details`,
    duration: 4,
    id,
    image: null,
    isDeleted: false,
    isFulfilled: false,
    location: "Austin, TX",
    photographer: { avatar: null, name: owner === ME ? "Me Myself" : "Ann Lee", userId: owner },
    photographerId: `ph-${owner}`,
    title,
    updatedAt: new Date(Date.now() - DAY),
  };
}

const page = (items: Array<ReturnType<typeof event>>, nextCursor: string | null = null) =>
  ({ items, nextCursor }) as unknown as FeedPage;
const applications = (rows: Array<{ eventId: string; status: string }>) =>
  rows.map((row) => ({ cancelOrigin: null, ...row })) as unknown as Applications;

const WEDDING = event("ev-1", "Garden wedding");
const GALA = event("ev-2", "Charity gala");
const MINE = event("ev-3", "My own shoot", { owner: ME });

function renderFeed(
  initial: FeedPage,
  handlers: { booking?: TrpcHandlers["booking"]; event?: TrpcHandlers["event"] } = {},
  locations = ["Austin, TX"],
) {
  return renderWithProviders(<EventsFeed currentUserId={ME} locations={locations} initialUpcoming={initial} />, {
    trpc: {
      booking: { getMyApplications: () => applications([]), ...handlers.booking },
      event: handlers.event,
    },
  });
}

const list = (name: string) => screen.findByRole("list", { name });
const cardOf = (title: string) => screen.getByRole("link", { name: title }).closest("article")!;

describe("EventsFeed", () => {
  it("shows the first page with each card's apply state from one request", async () => {
    const view = renderFeed(page([WEDDING, GALA, MINE]), {
      booking: { getMyApplications: () => applications([{ eventId: "ev-2", status: "applied" }]) },
    });

    expect(screen.getByRole("heading", { name: "Upcoming in Austin" })).toBeTruthy();
    const upcoming = await list("Upcoming events");
    expect(within(upcoming).getAllByRole("article")).toHaveLength(3);

    expect(await within(cardOf("Garden wedding")).findByRole("button", { name: "Apply" })).toBeTruthy();
    expect(within(cardOf("Charity gala")).getByText("Applied")).toBeTruthy();
    expect(within(cardOf("My own shoot")).getByText("Your event")).toBeTruthy();
    expect(view.callsTo("booking.getMyApplications")).toEqual([{ limit: 100 }]);
    // The server just rendered the first page: it is not asked for again.
    expect(view.callsTo("event.getFeedPage")).toEqual([]);
    expect(view.callsTo("booking.hasApplied")).toEqual([]);
  });

  it("asks per card, except for the member's own events, when the applications request fails", async () => {
    const view = renderFeed(page([WEDDING, MINE]), {
      booking: {
        getMyApplications: () => {
          throw trpcError("INTERNAL_SERVER_ERROR", "db down");
        },
        hasApplied: () => ({ applyBlockedBy: null, canReapply: false, hasApplied: true, status: "accepted" }),
      },
    });

    expect(await within(cardOf("Garden wedding")).findByText("You're booked")).toBeTruthy();
    expect(view.callsTo("booking.hasApplied")).toEqual([{ eventId: "ev-1" }]);
  });

  it("loads the next page with the cursor and adds it to the list", async () => {
    const view = renderFeed(page([WEDDING], "cursor-1"), {
      event: { getFeedPage: () => page([GALA]) },
    });

    expect((await screen.findByTestId("events-partial")).textContent).toBe("Showing 1 event");
    await userEvent.click(screen.getByRole("button", { name: "Load more events" }));

    expect(await screen.findByRole("link", { name: "Charity gala" })).toBeTruthy();
    expect(within(await list("Upcoming events")).getAllByRole("article")).toHaveLength(2);
    expect(view.callsTo("event.getFeedPage")).toEqual([
      { cursor: "cursor-1", direction: "forward", limit: 12, locations: ["Austin, TX"], when: "upcoming" },
    ]);
    expect(screen.queryByRole("button", { name: "Load more events" })).toBeNull();
  });

  it("says so under the button when the next page fails, keeping the list", async () => {
    renderFeed(page([WEDDING], "cursor-1"), {
      event: {
        getFeedPage: () => {
          throw trpcError("INTERNAL_SERVER_ERROR", "db down");
        },
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Load more events" }));

    expect(await screen.findByText("We couldn't load more events. Please try again.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Garden wedding" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load more events" })).toBeTruthy();
  });

  it("starts the list again from its first page when the cursor is no longer valid", async () => {
    const view = renderFeed(page([WEDDING], "stale"), {
      event: {
        getFeedPage: (input) => {
          if (input.cursor) throw trpcError("BAD_REQUEST", "This page of the feed is no longer available. Reload the feed.");
          return page([GALA, WEDDING]);
        },
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Load more events" }));

    expect(await screen.findByRole("link", { name: "Charity gala" })).toBeTruthy();
    expect(view.callsTo("event.getFeedPage")).toEqual([
      { cursor: "stale", direction: "forward", limit: 12, locations: ["Austin, TX"], when: "upcoming" },
      { direction: "forward", limit: 12, locations: ["Austin, TX"], when: "upcoming" },
    ]);
  });

  it("offers search when nothing is coming up", async () => {
    renderFeed(page([]));

    expect(await screen.findByText("Nothing coming up in Austin")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Search events" }).getAttribute("href")).toBe("/app/search");
  });

  it("names no place when the member has no location", async () => {
    renderFeed(page([]), {}, []);

    expect(screen.getByRole("heading", { name: "Upcoming" })).toBeTruthy();
    expect(await screen.findByText("Nothing coming up yet")).toBeTruthy();
  });

  it("loads past events on the Past tab, marked as past", async () => {
    const past = event("ev-9", "Spring recital", { daysAhead: -10 });
    const view = renderFeed(page([WEDDING]), { event: { getFeedPage: () => page([past]) } });

    await userEvent.click(screen.getByRole("tab", { name: "Past" }));

    expect(screen.getByRole("heading", { name: "Past events in Austin" })).toBeTruthy();
    const pastList = await list("Past events");
    expect(within(pastList).getByText("Past event")).toBeTruthy();
    expect(within(pastList).queryByRole("button", { name: "Apply" })).toBeNull();
    expect(view.callsTo("event.getFeedPage")).toEqual([{ direction: "forward", limit: 12, locations: ["Austin, TX"], when: "past" }]);
  });

  it("says when there are no past events", async () => {
    renderFeed(page([WEDDING]), { event: { getFeedPage: () => page([]) } });

    await userEvent.click(screen.getByRole("tab", { name: "Past" }));

    expect(await screen.findByText("No past events in Austin")).toBeTruthy();
  });

  it("shows a loading state, then says the list could not load, and Try again loads it", async () => {
    let calls = 0;
    let failFirst!: (error: unknown) => void;
    renderFeed(page([WEDDING]), {
      event: {
        getFeedPage: () => {
          calls += 1;
          if (calls === 1) return new Promise<never>((_resolve, reject) => (failFirst = reject));
          return page([event("ev-9", "Spring recital", { daysAhead: -10 })]);
        },
      },
    });

    await userEvent.click(screen.getByRole("tab", { name: "Past" }));
    expect((await screen.findByLabelText("Loading past events")).getAttribute("aria-busy")).toBe("true");
    failFirst(trpcError("INTERNAL_SERVER_ERROR", "db down"));

    expect(await screen.findByText("We couldn't load events")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("link", { name: "Spring recital" })).toBeTruthy();
  });

  it("is operable from the keyboard: arrow keys move between the tabs", async () => {
    renderFeed(page([WEDDING]), { event: { getFeedPage: () => page([]) } });

    screen.getByRole("tab", { name: "Upcoming" }).focus();
    await userEvent.keyboard("{ArrowRight}");

    await waitFor(() => expect(screen.getByRole("tab", { name: "Past" }).getAttribute("aria-selected")).toBe("true"));
    expect(await screen.findByText("No past events in Austin")).toBeTruthy();
  });
});
