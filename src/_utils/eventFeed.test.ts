import { describe, expect, it } from "vitest";

import { EVENTS_PAGE_SIZE, feedView, isFeedWhen } from "./eventFeed";

const page = (ids: string[], nextCursor: string | null) => ({ items: ids.map((id) => ({ id })), nextCursor });
const ids = (count: number, from = 0) => Array.from({ length: count }, (_, index) => `e${from + index}`);

describe("feedView", () => {
  it("is empty before anything has loaded", () => {
    expect(feedView(undefined)).toEqual({ events: [], hasMore: false, note: null });
  });

  it("keeps the server's order across pages", () => {
    const view = feedView([page(["a", "b"], "b"), page(["c", "d"], null)]);
    expect(view.events.map((event) => event.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("offers more exactly while the last page has a cursor", () => {
    expect(feedView([page(["a"], "a")]).hasMore).toBe(true);
    expect(feedView([page(["a"], "a"), page(["b"], null)]).hasMore).toBe(false);
    // An earlier page's cursor says nothing once a later page has loaded.
    expect(feedView([page(["a"], "a"), page([], null)]).hasMore).toBe(false);
  });

  it("goes past any fixed number of events", () => {
    // Six full pages: more than the old feed could ever show (48).
    const pages = Array.from({ length: 6 }, (_, index) =>
      page(ids(EVENTS_PAGE_SIZE, index * EVENTS_PAGE_SIZE), `e${(index + 1) * EVENTS_PAGE_SIZE - 1}`),
    );
    const view = feedView(pages);
    expect(view.events).toHaveLength(72);
    expect(view.hasMore).toBe(true);
    expect(view.note).toBe("Showing 72 events");
  });

  it("shows an event once when it turns up on two pages", () => {
    const view = feedView([page(["a", "b"], "b"), page(["b", "c"], null)]);
    expect(view.events.map((event) => event.id)).toEqual(["a", "b", "c"]);
  });

  it("says how many are shown only while there are more", () => {
    expect(feedView([page(["a"], "a")]).note).toBe("Showing 1 event");
    expect(feedView([page(["a", "b"], null)]).note).toBeNull();
  });
});

describe("isFeedWhen", () => {
  it("accepts the two lists and nothing else", () => {
    expect(isFeedWhen("upcoming")).toBe(true);
    expect(isFeedWhen("past")).toBe(true);
    expect(isFeedWhen("all")).toBe(false);
    expect(isFeedWhen(null)).toBe(false);
  });
});
