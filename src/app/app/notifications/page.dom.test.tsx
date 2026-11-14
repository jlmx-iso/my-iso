// @vitest-environment happy-dom
//
// The notifications page: loading, error with retry, empty states per
// filter, unread ones marked (a "New" badge, the count in the header and on
// the Unread filter), opening one marks it read (a link on the way, a
// button when there is nowhere to go), "Mark all as read", and "Load more"
// appending the next page without duplicates.

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import type { RouterOutputs } from "~/trpc/react";

import NotificationsPage from "./page";

type Notification = RouterOutputs["notification"]["getAll"]["notifications"][number];
type NotificationHandlers = NonNullable<TrpcHandlers["notification"]>;

const NOW = new Date();

function notification(id: string, overrides: Partial<Notification> = {}): Notification {
  return {
    body: `Body of ${id}`,
    createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    data: null,
    id,
    isRead: false,
    linkUrl: null,
    recipientId: "me",
    title: `Title of ${id}`,
    type: "booking_applied",
    ...overrides,
  };
}

/** A server holding `all`, answering pages the way notification.getAll does. */
function server(all: Notification[]): NotificationHandlers {
  return {
    getAll: ({ limit = 20, offset = 0, unreadOnly = false }) => {
      const matching = unreadOnly ? all.filter((n) => !n.isRead) : all;
      return {
        notifications: matching.slice(offset, offset + limit),
        totalCount: matching.length,
        unreadCount: all.filter((n) => !n.isRead).length,
      };
    },
    markAllAsRead: () => {
      const count = all.filter((n) => !n.isRead).length;
      for (const n of all) n.isRead = true;
      return { count };
    },
    markAsRead: ({ notificationId }) => {
      const found = all.find((n) => n.id === notificationId)!;
      found.isRead = true;
      return found;
    },
  };
}

function renderPage(notifications: NotificationHandlers) {
  return renderWithProviders(<NotificationsPage />, { trpc: { notification: notifications } });
}

const rows = () => screen.getAllByTestId("notification-row");

// Following a link would make happy-dom load the page: stop the browser's
// default (the app's own click handlers still run first).
const stopNavigation = (event: MouseEvent) => {
  if ((event.target as Element | null)?.closest("a")) event.preventDefault();
};
beforeEach(() => document.addEventListener("click", stopNavigation));
afterEach(() => document.removeEventListener("click", stopNavigation));

describe("notifications page", () => {
  it("shows a skeleton, then the notifications with the unread ones marked and counted", async () => {
    const view = renderPage(
      server([
        notification("n1", { title: "Ann applied to Garden wedding" }),
        notification("n2", { isRead: true, title: "Ben left you a review", type: "review_received" }),
        notification("n3", { type: "something_new" }),
      ]),
    );

    expect(screen.getByLabelText("Loading notifications")).toBeTruthy();
    expect(await screen.findByText("Ann applied to Garden wedding")).toBeTruthy();
    expect(view.callsTo("notification.getAll")).toEqual([{ limit: 20, offset: 0, unreadOnly: false }]);
    expect(screen.getByText("You have 2 unread notifications")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Unread (2)" })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Notifications" })).getAllByRole("listitem")).toHaveLength(3);
    expect(within(rows()[0]!).getByText("New")).toBeTruthy();
    expect(within(rows()[0]!).getByText(/hour ago$/)).toBeTruthy();
    expect(within(rows()[1]!).queryByText("New")).toBeNull();
  });

  it("marks one read when it is opened, through its link, and refreshes the list", async () => {
    const view = renderPage(server([notification("n1", { linkUrl: "/app/bookings?tab=received" })]));
    const link = await screen.findByRole("link", { name: /Title of n1/ });
    expect(link.getAttribute("href")).toBe("/app/bookings?tab=received");

    await userEvent.click(link);

    await waitFor(() => expect(view.callsTo("notification.markAsRead")).toEqual([{ notificationId: "n1" }]));
    expect(await screen.findByText("You're all caught up")).toBeTruthy();
    expect(within(rows()[0]!).queryByText("New")).toBeNull();
  });

  it("does not mark again one that is already read", async () => {
    const view = renderPage(server([notification("n1", { isRead: true, linkUrl: "/app/messages/t1" })]));
    await userEvent.click(await screen.findByRole("link", { name: /Title of n1/ }));
    expect(view.callsTo("notification.markAsRead")).toEqual([]);
    // Read and with nowhere to go: plain text, nothing to press.
    expect(screen.queryByRole("button", { name: /Mark as read/ })).toBeNull();
  });

  it("marks one with nowhere to go read with a button, which then becomes plain text", async () => {
    const view = renderPage(server([notification("n1")]));

    await userEvent.click(await screen.findByRole("button", { name: /Mark as read: Title of n1/ }));

    await waitFor(() => expect(view.callsTo("notification.markAsRead")).toEqual([{ notificationId: "n1" }]));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Mark as read/ })).toBeNull());
    expect(screen.getByText("Title of n1")).toBeTruthy();
  });

  it("marks everything read at once", async () => {
    const view = renderPage(server([notification("n1"), notification("n2")]));

    await userEvent.click(await screen.findByRole("button", { name: "Mark all as read" }));

    expect(await screen.findByText("You're all caught up")).toBeTruthy();
    expect(view.callsTo("notification.markAllAsRead")).toEqual([undefined]);
    expect(screen.queryByRole("button", { name: "Mark all as read" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Unread" })).toBeTruthy();
  });

  it("shows only the unread ones on the Unread filter, and says when there are none", async () => {
    const all = [notification("n1"), notification("n2", { isRead: true })];
    const view = renderPage(server(all));
    await screen.findByText("Title of n1");

    await userEvent.click(screen.getByRole("radio", { name: "Unread (1)" }));

    await waitFor(() => expect(screen.queryByText("Title of n2")).toBeNull());
    expect(screen.getByText("Title of n1")).toBeTruthy();
    expect(view.callsTo("notification.getAll")).toContainEqual({ limit: 20, offset: 0, unreadOnly: true });

    await userEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    expect(await screen.findByText("No unread notifications")).toBeTruthy();
    expect(screen.getByText("You've read all your notifications.")).toBeTruthy();
  });

  it("says when there are no notifications at all", async () => {
    renderPage(server([]));
    expect(await screen.findByText("No notifications yet")).toBeTruthy();
    expect(screen.getByText("You're all caught up")).toBeTruthy();
  });

  it("loads the next page under the first, once each", async () => {
    const all = Array.from({ length: 25 }, (_, i) => notification(`n${i + 1}`, { isRead: true }));
    const view = renderPage(server(all));
    await screen.findByText("Title of n1");
    expect(rows()).toHaveLength(20);

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Title of n25")).toBeTruthy();
    expect(rows()).toHaveLength(25);
    expect(view.callsTo("notification.getAll")).toContainEqual({ limit: 20, offset: 20, unreadOnly: false });
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("offers a retry when the notifications cannot be loaded", async () => {
    let calls = 0;
    const working = server([notification("n1")]);
    renderPage({
      ...working,
      getAll: (input) => {
        calls += 1;
        if (calls === 1) throw trpcError("INTERNAL_SERVER_ERROR", "Internal error");
        return working.getAll!(input);
      },
    });

    expect(await screen.findByText("We couldn't load your notifications")).toBeTruthy();
    // No guess about the unread count over an error.
    expect(screen.queryByText("You're all caught up")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Title of n1")).toBeTruthy();
  });
});
