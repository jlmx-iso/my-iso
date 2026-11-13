// @vitest-environment happy-dom
//
// The bell in the header and its dropdown: the unread count on the button
// (in its name for screen readers), the five latest notifications fetched
// only once it is opened, opening one marks it read and goes to its link,
// "Mark all read", and the loading, empty and error wording.

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { testRouter } from "~/test/dom/navigation";
import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import type { RouterOutputs } from "~/trpc/react";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));

import { NotificationBell } from "./NotificationBell";

type Notification = RouterOutputs["notification"]["getAll"]["notifications"][number];
type NotificationHandlers = NonNullable<TrpcHandlers["notification"]>;

function notification(id: string, overrides: Partial<Notification> = {}): Notification {
  return {
    body: `Body of ${id}`,
    createdAt: new Date(),
    data: null,
    id,
    isRead: false,
    linkUrl: null,
    recipientId: "me",
    title: `Title of ${id}`,
    type: "new_message",
    ...overrides,
  };
}

function renderBell(unreadCount: number, handlers: NotificationHandlers) {
  return renderWithProviders(<NotificationBell unreadCount={unreadCount} />, {
    trpc: {
      notification: {
        markAllAsRead: () => ({ count: 0 }),
        markAsRead: ({ notificationId }) => notification(notificationId, { isRead: true }),
        ...handlers,
      },
    },
  });
}

const page = (notifications: Notification[]) => ({
  notifications,
  totalCount: notifications.length,
  unreadCount: notifications.filter((n) => !n.isRead).length,
});

describe("NotificationBell", () => {
  it("names the unread count, and fetches nothing until opened", async () => {
    const view = renderBell(3, { getAll: () => page([]) });
    const bell = screen.getByRole("button", { name: "Notifications, 3 unread" });
    expect(bell.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("3")).toBeTruthy();
    expect(view.calls).toEqual([]);

    await userEvent.click(bell);

    expect(bell.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByText("No notifications yet")).toBeTruthy();
    expect(view.callsTo("notification.getAll")).toEqual([{ limit: 5, offset: 0, unreadOnly: false }]);
  });

  it("caps the badge at 99+ and says just Notifications with none unread", () => {
    const view = renderBell(150, { getAll: () => page([]) });
    expect(screen.getByText("99+")).toBeTruthy();
    view.unmount();

    renderBell(0, { getAll: () => page([]) });
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });

  it("opens a notification: marks it read, goes to its link and closes", async () => {
    const view = renderBell(1, {
      getAll: () => page([notification("n1", { linkUrl: "/app/messages/t1", title: "Bea wrote to you" })]),
    });
    await userEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));

    await userEvent.click(await screen.findByRole("button", { name: /Unread: Bea wrote to you/ }));

    await waitFor(() => expect(view.callsTo("notification.markAsRead")).toEqual([{ notificationId: "n1" }]));
    expect(testRouter.push).toHaveBeenCalledWith("/app/messages/t1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notifications, 1 unread" }).getAttribute("aria-expanded")).toBe("false"),
    );
  });

  it("does not mark a read one again, nor navigate without a link", async () => {
    const view = renderBell(0, { getAll: () => page([notification("n1", { isRead: true })]) });
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));

    await userEvent.click(await screen.findByRole("button", { name: /^Title of n1/ }));

    expect(view.callsTo("notification.markAsRead")).toEqual([]);
    expect(testRouter.push).not.toHaveBeenCalled();
  });

  it("marks all read and refreshes", async () => {
    let read = false;
    const view = renderBell(2, {
      getAll: () => page([notification("n1", { isRead: read }), notification("n2", { isRead: read })]),
      markAllAsRead: () => {
        read = true;
        return { count: 2 };
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));

    await userEvent.click(await screen.findByRole("button", { name: "Mark all read" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull());
    expect(view.callsTo("notification.markAllAsRead")).toEqual([undefined]);
    expect(screen.getByRole("link", { name: "View all notifications" }).getAttribute("href")).toBe(
      "/app/notifications",
    );
  });

  it("says when the notifications could not be loaded", async () => {
    renderBell(0, {
      getAll: () => {
        throw trpcError("INTERNAL_SERVER_ERROR", "Internal error");
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("Couldn't load notifications.")).toBeTruthy();
  });

  it("says it is loading meanwhile", async () => {
    renderBell(0, { getAll: () => new Promise(() => undefined) });
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("Loading…")).toBeTruthy();
  });
});
