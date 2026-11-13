// @vitest-environment happy-dom
//
// Search: the query lives in the URL (?q=), so submitting pushes a history
// entry and the results follow the URL. Results come a page at a time
// (asking for one more than a page to know whether there is more), can be
// narrowed to photographers or events on screen, and filtered by location
// (debounced). Loading, nothing found, errors and "Load more" are each said,
// also to screen readers.

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { testRouter } from "~/test/dom/navigation";
import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import type { RouterOutputs } from "~/trpc/react";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));

import SearchPage from "./page";

type Results = RouterOutputs["search"]["searchAll"];
type SearchAll = NonNullable<NonNullable<TrpcHandlers["search"]>["searchAll"]>;

const USER = { firstName: "Bea", id: "bea", lastName: "Cole", profilePic: null };

function photographer(id: string, name = `Photographer ${id}`) {
  return {
    bio: null,
    companyName: null,
    id,
    isPro: false,
    location: "Austin, TX",
    name,
    portfolioImages: [],
    user: { ...USER, id: `user-${id}` },
  } as unknown as Results["photographers"][number];
}

function event(id: string, title = `Event ${id}`) {
  return {
    _count: { comments: 2, eventLikes: 5 },
    date: new Date("2030-06-01T15:00:00Z"),
    description: null,
    duration: 4,
    id,
    image: null,
    location: "Austin, TX",
    payCents: null,
    photographer: { isPro: false, name: "Bea Cole", user: USER },
    timeZone: null,
    title,
  } as unknown as Results["events"][number];
}

function results(photographers: Results["photographers"], events: Results["events"]): Results {
  return { events, photographers };
}

function renderSearch(searchAll: SearchAll, query?: string) {
  testRouter.setLocation("/app/search", query === undefined ? "" : `q=${encodeURIComponent(query)}`);
  return renderWithProviders(<SearchPage />, {
    trpc: { google: { getAutocompleteLocations: () => [] }, search: { searchAll } },
  });
}

const box = () => screen.getByRole("searchbox", { name: "Search photographers and events" }) as HTMLInputElement;
const status = () => screen.getAllByRole("status").find((element) => element.getAttribute("aria-atomic") === "true")!;

describe("search page", () => {
  it("invites a search before there is one, and asks nothing of the server", () => {
    const view = renderSearch(() => results([], []));
    expect(screen.getByText("Discover the network")).toBeTruthy();
    expect(view.calls).toEqual([]);
  });

  it("puts a submitted query in the URL, trimmed and encoded", async () => {
    renderSearch(() => results([], []));

    await userEvent.type(box(), "  wedding & gala  ");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(testRouter.push).toHaveBeenCalledWith("/app/search?q=wedding%20%26%20gala", { scroll: false });
  });

  it("clears the search when an empty query is submitted", async () => {
    renderSearch(() => results([], []), "wedding");
    await userEvent.clear(box());
    await userEvent.type(box(), "{Enter}");
    expect(testRouter.push).toHaveBeenCalledWith("/app/search", { scroll: false });
  });

  it("does not search again for the query already shown", async () => {
    renderSearch(() => results([], []), "wedding");
    await userEvent.type(box(), "{Enter}");
    expect(testRouter.push).not.toHaveBeenCalled();
  });

  it("searches for the query in the URL and shows photographers and events", async () => {
    const view = renderSearch(() => results([photographer("p1", "Ann Lee")], [event("e1", "Garden wedding")]), "wedding");

    expect(box().value).toBe("wedding");
    expect(status().textContent).toBe("Searching…");
    expect(await screen.findByRole("link", { name: "Ann Lee" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Garden wedding" }).getAttribute("href")).toBe("/app/events/e1");
    expect(screen.getByRole("link", { name: "Ann Lee" }).getAttribute("href")).toBe("/app/photographer/user-p1");
    expect(status().textContent).toBe("2 results for wedding");
    expect(view.callsTo("search.searchAll")).toEqual([
      { filters: { type: "all" }, limit: 21, location: undefined, offset: 0, query: "wedding" },
    ]);
  });

  it("narrows the results on screen without asking the server again", async () => {
    const view = renderSearch(() => results([photographer("p1", "Ann Lee")], [event("e1", "Garden wedding")]), "wedding");
    await screen.findByRole("link", { name: "Ann Lee" });

    await userEvent.click(screen.getByRole("radio", { name: "Photographers (1)" }));
    expect(screen.queryByRole("link", { name: "Garden wedding" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Photographers" })).toBeTruthy();

    await userEvent.click(screen.getByRole("radio", { name: "Events (1)" }));
    expect(screen.queryByRole("link", { name: "Ann Lee" })).toBeNull();
    expect(screen.getByRole("link", { name: "Garden wedding" })).toBeTruthy();

    expect(screen.getByRole("radio", { name: "All (2)" })).toBeTruthy();
    expect(view.callsTo("search.searchAll")).toHaveLength(1);
  });

  it("says when nothing was found, with a hint", async () => {
    renderSearch(() => results([], []), "zzz");
    expect(await screen.findByText('No results for "zzz"')).toBeTruthy();
    expect(screen.getByText(/Try a different spelling, a first name, a city/)).toBeTruthy();
    expect(status().textContent).toBe("No results for zzz");
  });

  it("explains a failed search and tries again", async () => {
    let calls = 0;
    renderSearch(() => {
      calls += 1;
      if (calls === 1) throw trpcError("TOO_MANY_REQUESTS", "You're searching too fast. Try again in a minute.");
      return results([photographer("p1", "Ann Lee")], []);
    }, "ann");

    expect(await screen.findByText("Search didn't work")).toBeTruthy();
    expect(screen.getByText("You're searching too fast. Try again in a minute.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Ann Lee" })).toBeTruthy();
    expect(status().textContent).toBe("1 result for ann");
  });

  it("loads more results a page at a time, and retries a page that failed", async () => {
    const many = (prefix: string, from: number, count: number) =>
      Array.from({ length: count }, (_, i) => photographer(`${prefix}${from + i}`, `Name ${from + i}`));
    let failSecond = true;
    const view = renderSearch(({ offset = 0 }) => {
      if (offset === 0) return results(many("p", 1, 21), []);
      if (failSecond) {
        failSecond = false;
        throw trpcError("INTERNAL_SERVER_ERROR", "Internal error");
      }
      return results(many("p", 21, 5), []);
    }, "portrait");

    expect(await screen.findByText("Showing the first 20 results")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "All (20+)" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Photographers (20+)" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Events (0)" })).toBeTruthy();
    expect(status().textContent).toBe("Showing the first 20 results for portrait. More are available.");
    expect(screen.queryByRole("link", { name: "Name 21" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Load more results" }));
    expect(await screen.findByText("We couldn't load more results. Please try again.")).toBeTruthy();
    expect(view.callsTo("search.searchAll")).toContainEqual({
      filters: { type: "all" },
      limit: 21,
      location: undefined,
      offset: 20,
      query: "portrait",
    });

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Name 25" })).toBeTruthy();
    expect(screen.getAllByTestId("search-photographer-card")).toHaveLength(25);
    expect(screen.queryByRole("button", { name: "Load more results" })).toBeNull();
    expect(status().textContent).toBe("25 results for portrait");
  });

  it("filters by location once typing pauses, and mentions the filter when nothing is found", async () => {
    const view = renderSearch(({ location }) => (location ? results([], []) : results([photographer("p1")], [])), "ann");
    await screen.findByRole("link", { name: "Photographer p1" });

    const filters = screen.getByRole("button", { name: "Filters" });
    expect(filters.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(filters);
    expect(filters.getAttribute("aria-expanded")).toBe("true");

    await userEvent.type(screen.getByLabelText(/^Location/, { selector: "input" }), "Austin");
    expect(screen.getByRole("button", { name: "Filters (active)" })).toBeTruthy();

    await waitFor(
      () => expect(view.callsTo("search.searchAll")).toContainEqual(expect.objectContaining({ location: "Austin", offset: 0 })),
      { timeout: 2000 },
    );
    expect(await screen.findByText("Try a different spelling, or remove the location and date filters.")).toBeTruthy();
    // One search for the whole word, not one per keystroke.
    expect(view.callsTo("search.searchAll")).toHaveLength(2);
  });

  it("asks for the end date before filtering by a date range", async () => {
    const view = renderSearch(() => results([photographer("p1")], []), "ann");
    await screen.findByRole("link", { name: "Photographer p1" });
    await userEvent.click(screen.getByRole("button", { name: "Filters" }));

    await userEvent.click(screen.getByRole("button", { name: /^Event dates/ }));
    const days = within(await screen.findByRole("table")).getAllByRole("button");
    await userEvent.click(days[10]!);
    expect(screen.getByText("Now choose the end date. The filter applies once both are set.")).toBeTruthy();
    expect(view.callsTo("search.searchAll")).toHaveLength(1);

    await userEvent.click(days[12]!);
    await waitFor(() => expect(view.callsTo("search.searchAll")).toHaveLength(2));
    const [, withDates] = view.callsTo("search.searchAll") as Array<{ filters: { dateFrom?: Date; dateTo?: Date } }>;
    expect(withDates!.filters.dateFrom).toBeInstanceOf(Date);
    expect(withDates!.filters.dateTo!.getTime()).toBeGreaterThan(withDates!.filters.dateFrom!.getTime());
    expect(screen.getByRole("button", { name: "Filters (active)" })).toBeTruthy();
  });
});
