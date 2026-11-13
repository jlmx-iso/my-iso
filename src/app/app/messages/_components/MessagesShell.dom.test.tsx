// @vitest-environment happy-dom
//
// The two-pane messages screen: which pane a phone shows follows the URL
// (the list at /app/messages, the thread at /app/messages/[id]); the open
// conversation is marked in the list; a wide screen on the bare list is
// sent to the most recent conversation (unless a ?new= link is opening the
// composer); and with an on-screen keyboard up (iOS) the shell shrinks to
// the visual viewport.

import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testRouter } from "~/test/dom/navigation";
import { renderWithProviders } from "~/test/dom/render";
import type { RouterOutputs } from "~/trpc/react";

const layout = vi.hoisted(() => ({ segment: null as string | null }));
vi.mock("next/navigation", async () => ({
  ...(await import("~/test/dom/navigation")),
  useSelectedLayoutSegment: () => layout.segment,
}));

import type { ConversationSummary } from "./ConversationList";
import MessagesShell from "./MessagesShell";

type Latest = NonNullable<RouterOutputs["message"]["getLatestThreadMessage"]>;

const ME = { firstName: "Me", id: "me", lastName: "Self", photographer: null, profilePic: null };
const WIDE_SCREEN_QUERY = "(min-width: 62em)";

function conversation(id: string, firstName: string, minutesAgo: number): ConversationSummary {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  const other = { firstName, id: `u-${id}`, lastName: "Lee", photographer: null, profilePic: null };
  const lastMessage: Latest = { content: `from ${firstName}`, createdAt: at, id: `m-${id}`, sender: { ...other }, updatedAt: at };
  return { hasUnread: false, id, lastMessage, participants: [other, ME], unreadCount: 0 };
}

const OLDER = conversation("t-old", "Ann", 60);
const NEWER = conversation("t-new", "Ben", 5);

let wideScreen = true;

function renderShell(threads: ConversationSummary[] = [OLDER, NEWER]) {
  return renderWithProviders(
    <MessagesShell initialThreads={threads} initialNextCursor={null} currentUserId="me">
      <p>Thread pane</p>
    </MessagesShell>,
    {
      trpc: {
        message: {
          getLatestThreadMessage: () => null,
          getRecipientById: () => null,
          getThreadByParticipants: () => null,
          getThreadsPage: () => ({ items: threads.map(({ lastMessage: _drop, ...t }) => t), nextCursor: null }),
        },
      },
    },
  );
}

const shell = () => screen.getByRole("heading", { name: "Messages" }).closest("[data-pane]")!;

beforeEach(() => {
  layout.segment = null;
  wideScreen = true;
  testRouter.setLocation("/app/messages");
  const realMatchMedia = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) =>
    query === WIDE_SCREEN_QUERY ? ({ ...realMatchMedia(query), matches: wideScreen }) : realMatchMedia(query),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MessagesShell", () => {
  it("shows the list pane on /app/messages, with the conversations and the composer button", () => {
    wideScreen = false;
    renderShell();

    expect(shell().getAttribute("data-pane")).toBe("list");
    const list = within(screen.getByRole("complementary", { name: "Conversations" }));
    expect(list.getAllByTestId("conversation-row")).toHaveLength(2);
    expect(within(screen.getByRole("region", { name: "Conversation" })).getByText("Thread pane")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New message" })).toBeTruthy();
    expect(testRouter.replace).not.toHaveBeenCalled();
  });

  it("shows the thread pane on a thread's URL and marks that conversation open", () => {
    layout.segment = "t-old";
    renderShell();

    expect(shell().getAttribute("data-pane")).toBe("thread");
    const open = screen.getAllByTestId("conversation-row").find((row) => row.getAttribute("aria-current") === "page");
    expect(open?.getAttribute("href")).toBe("/app/messages/t-old");
    expect(testRouter.replace).not.toHaveBeenCalled();
  });

  it("sends a wide screen on the bare list to the most recent conversation", () => {
    renderShell();
    expect(testRouter.replace).toHaveBeenCalledWith("/app/messages/t-new");
  });

  it("leaves a wide screen on the list when there is no conversation", () => {
    renderShell([]);
    expect(testRouter.replace).not.toHaveBeenCalled();
  });

  it("leaves a ?new= link to open the composer", async () => {
    testRouter.setLocation("/app/messages", "new=u-cal");
    renderShell();
    expect(await screen.findByRole("dialog", { name: "New message" })).toBeTruthy();
    expect(testRouter.replace).not.toHaveBeenCalled();
  });

  it("fits the visual viewport while an on-screen keyboard is up, and stops listening when gone", () => {
    const viewport = Object.assign(new EventTarget(), { height: window.innerHeight });
    const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const removeListener = vi.spyOn(viewport, "removeEventListener");
    try {
      wideScreen = false;
      const view = renderShell();
      const element = shell() as HTMLElement;
      expect(element.style.getPropertyValue("--messages-viewport")).toBe("");

      act(() => {
        viewport.height = window.innerHeight - 300.4;
        viewport.dispatchEvent(new Event("resize"));
      });
      expect(element.style.getPropertyValue("--messages-viewport")).toBe(`${Math.round(window.innerHeight - 300.4)}px`);
      expect(element.style.getPropertyValue("--messages-bottom")).toBe("0px");
      expect(scrollTo).toHaveBeenCalledWith(0, 0);

      act(() => {
        viewport.height = window.innerHeight;
        viewport.dispatchEvent(new Event("resize"));
      });
      expect(element.style.getPropertyValue("--messages-viewport")).toBe("");
      expect(element.style.getPropertyValue("--messages-bottom")).toBe("");

      view.unmount();
      expect(removeListener).toHaveBeenCalledWith("resize", expect.any(Function));
    } finally {
      if (original) Object.defineProperty(window, "visualViewport", original);
      else Reflect.deleteProperty(window, "visualViewport");
    }
  });
});
