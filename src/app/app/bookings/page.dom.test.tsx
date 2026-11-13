// @vitest-environment happy-dom
//
// The bookings page: two tabs (my applications, applications received),
// each loading a page at a time, grouped into "Needs you", "Upcoming",
// "Past" and "Closed" with counts, a badge on the tab for what needs the
// viewer, the tab in the URL, empty and error states, and "Load more".

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { testRouter } from "~/test/dom/navigation";
import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import type { RouterOutputs } from "~/trpc/react";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));

import BookingsPage from "./page";

type BookingHandlers = NonNullable<TrpcHandlers["booking"]>;
type Sent = RouterOutputs["booking"]["getMyApplicationsPage"]["items"][number];
type Received = RouterOutputs["booking"]["getReceivedApplicationsPage"]["items"][number];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const BEA = { firstName: "Bea", id: "bea", isPro: false, lastName: "Cole", profilePic: null };
const CAL = { firstName: "Cal", id: "cal", isPro: false, lastName: "Diaz", profilePic: null };

function booking(id: string, status: string, startsIn: number, title = `Event ${id}`) {
  return {
    cancelOrigin: null,
    createdAt: new Date(Date.now() - DAY),
    event: {
      date: new Date(Date.now() + startsIn),
      duration: 2,
      id: `ev-${id}`,
      location: "Austin, TX",
      payCents: null,
      timeZone: null,
      title,
    },
    id,
    notes: null,
    ownerNotes: null,
    rate: null,
    status,
  };
}

const sent = (id: string, status: string, startsIn: number, title?: string) =>
  ({ ...booking(id, status, startsIn, title), owner: BEA }) as unknown as Sent;
const received = (id: string, status: string, startsIn: number, title?: string) =>
  ({ ...booking(id, status, startsIn, title), applicant: CAL }) as unknown as Received;

function renderPage(handlers: BookingHandlers) {
  return renderWithProviders(<BookingsPage />, {
    trpc: {
      booking: {
        getMyApplicationsPage: () => ({ items: [], nextCursor: null }),
        getReceivedApplicationsPage: () => ({ items: [], nextCursor: null }),
        ...handlers,
      },
    },
  });
}

const tab = (name: RegExp) => screen.getByRole("tab", { name });
const panel = () => screen.getByRole("tabpanel");

describe("bookings page", () => {
  it("groups my applications under headings with counts", async () => {
    const view = renderPage({
      getMyApplicationsPage: () => ({
        items: [
          sent("a1", "applied", 3 * DAY, "Garden wedding"),
          sent("a2", "accepted", 2 * DAY, "Beach portraits"),
          sent("a3", "accepted", -DAY, "Gala"),
          sent("a4", "declined", 5 * DAY, "Barn dance"),
          sent("a5", "completed", -3 * DAY, "Old shoot"),
        ],
        nextCursor: null,
      }),
    });

    expect(screen.getByLabelText("Loading your applications")).toBeTruthy();
    expect(await screen.findByText("Garden wedding")).toBeTruthy();
    expect(view.callsTo("booking.getMyApplicationsPage")).toEqual([{ direction: "forward", limit: 20 }]);

    // A finished accepted booking waits for the applicant to mark it completed.
    const needsYou = within(screen.getByTestId("group-needsReply"));
    expect(needsYou.getByRole("heading", { name: "Needs you (1)" })).toBeTruthy();
    expect(needsYou.getByText("Gala")).toBeTruthy();

    // Soonest first.
    const upcoming = screen.getByTestId("group-upcoming");
    expect(within(upcoming).getByRole("heading", { name: "Upcoming (2)" })).toBeTruthy();
    expect(within(upcoming).getAllByRole("link", { name: /Beach portraits|Garden wedding/ }).map((l) => l.textContent)).toEqual([
      "Beach portraits",
      "Garden wedding",
    ]);
    expect(within(screen.getByTestId("group-past")).getByText("Old shoot")).toBeTruthy();
    expect(within(screen.getByTestId("group-closed")).getByText("Barn dance")).toBeTruthy();

    // The tab says how many need the viewer.
    const badge = within(tab(/My applications/)).getByTestId("tab-needs-reply");
    expect(badge.textContent).toBe("1, 1 needs you");
  });

  it("opens the received tab from the URL and badges what waits for an answer", async () => {
    testRouter.setLocation("/app/bookings", "tab=received");
    renderPage({
      getReceivedApplicationsPage: () => ({
        items: [received("r1", "applied", DAY, "Garden wedding"), received("r2", "applied", 2 * DAY, "Barn dance")],
        nextCursor: null,
      }),
    });

    expect(tab(/Received/).getAttribute("aria-selected")).toBe("true");
    expect(await within(panel()).findByText("Garden wedding")).toBeTruthy();
    expect(within(panel()).getAllByRole("button", { name: "Accept" })).toHaveLength(2);
    expect(within(tab(/Received/)).getByTestId("tab-needs-reply").textContent).toBe("2, 2 need you");
    expect(within(tab(/My applications/)).queryByTestId("tab-needs-reply")).toBeNull();
  });

  it("puts the chosen tab in the URL", async () => {
    testRouter.setLocation("/app/bookings");
    renderPage({});
    await screen.findByText("No applications yet");

    await userEvent.click(tab(/Received/));
    expect(testRouter.replace).toHaveBeenLastCalledWith("/app/bookings?tab=received", { scroll: false });

    testRouter.setLocation("/app/bookings", "tab=received");
    await userEvent.click(tab(/My applications/));
    expect(testRouter.replace).toHaveBeenLastCalledWith("/app/bookings", { scroll: false });
  });

  it("explains an empty applications tab and points to events", async () => {
    renderPage({});
    expect(await screen.findByText("No applications yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Browse events" }).getAttribute("href")).toBe("/app/events");
  });

  it("explains an empty received tab", async () => {
    testRouter.setLocation("/app/bookings", "tab=received");
    renderPage({});
    expect(await screen.findByText("No applications received")).toBeTruthy();
  });

  it("offers a retry when a tab cannot be loaded", async () => {
    let calls = 0;
    renderPage({
      getMyApplicationsPage: () => {
        calls += 1;
        if (calls === 1) throw trpcError("INTERNAL_SERVER_ERROR", "Internal error");
        return { items: [sent("a1", "applied", DAY, "Garden wedding")], nextCursor: null };
      },
    });

    expect(await screen.findByText("We couldn't load your applications")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Garden wedding")).toBeTruthy();
  });

  it("loads older bookings with the cursor, says how many are shown, and reports a failed load", async () => {
    let failNext = false;
    testRouter.setLocation("/app/bookings", "tab=received");
    const view = renderPage({
      getReceivedApplicationsPage: (input) => {
        if (!input?.cursor) return { items: [received("r1", "applied", DAY, "First")], nextCursor: "r1" };
        if (failNext) throw trpcError("INTERNAL_SERVER_ERROR", "Internal error");
        return { items: [received("r2", "applied", 2 * DAY, "Second")], nextCursor: "r2" };
      },
    });

    expect(await within(panel()).findByText("Showing the 1 most recent")).toBeTruthy();
    // More may need an answer than are loaded.
    expect(within(tab(/Received/)).getByTestId("tab-needs-reply").textContent).toBe("1+, 1 needs you");

    await userEvent.click(within(panel()).getByRole("button", { name: "Load more" }));
    expect(await within(panel()).findByText("Second")).toBeTruthy();
    expect(view.callsTo("booking.getReceivedApplicationsPage")).toContainEqual({ cursor: "r1", direction: "forward", limit: 20 });
    await waitFor(() => expect(within(panel()).getByText("Showing the 2 most recent")).toBeTruthy());

    failNext = true;
    await userEvent.click(within(panel()).getByRole("button", { name: "Load more" }));
    expect(await within(panel()).findByText("We couldn't load more. Please try again.")).toBeTruthy();
    // What was loaded stays.
    expect(within(panel()).getByText("First")).toBeTruthy();
  });

  it("keeps a card in its group while its confirmation is open and after it is cancelled", async () => {
    testRouter.setLocation("/app/bookings", "tab=received");
    renderPage({
      getReceivedApplicationsPage: () => ({ items: [received("r1", "applied", DAY, "Garden wedding")], nextCursor: null }),
    });
    await within(panel()).findByText("Garden wedding");

    await userEvent.click(within(panel()).getByRole("button", { name: "Decline" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(screen.getByTestId("group-needsReply")).getByText("Garden wedding")).toBeTruthy();

    await userEvent.click(within(dialog).getByRole("button", { name: /Cancel|Keep/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(screen.getByTestId("group-needsReply")).getByText("Garden wedding")).toBeTruthy();
  });
});
