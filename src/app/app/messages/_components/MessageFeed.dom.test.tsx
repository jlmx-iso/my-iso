// @vitest-environment happy-dom
//
// MessageFeed's mark-read wiring (useMarkThreadRead), rendered: the thread
// is marked read up to the newest message once it has been on screen for
// MARK_READ_DELAY_MS with the tab visible, a failed call is retried on the
// markReadRetryDelayMs schedule while the thread stays open, an older
// request failing late does not disturb the newer one's retry, and a
// message already marked is not sent again.

import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ThreadMessage } from "~/_utils/threadMessages";
import { MARK_READ_DELAY_MS } from "~/app/_hooks/useMarkThreadRead";
import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import { testSession } from "~/test/dom/session";

// The realtime socket is replaced: the feed sees it as open (so it does not
// poll), and the test can push a message as the socket would.
const realtime = vi.hoisted(() => ({
  onMessage: null as ((message: unknown) => void) | null,
}));
vi.mock("~/app/_hooks/useMessageWebSocket", () => ({
  useMessageWebSocket: (options: { onMessage: (message: unknown) => void }) => {
    realtime.onMessage = options.onMessage;
    return "open";
  },
}));
vi.mock("next-auth/react", () => import("~/test/dom/session"));

import { MARK_READ_MAX_RETRIES } from "./markReadRetry";
import MessageFeed from "./MessageFeed";

const NOW = new Date("2030-06-01T12:00:00Z");
const SECOND = 1000;
const ME = "me";
const THREAD = "thread-1";

const OTHER = { firstName: "Bea", id: "bea", lastName: "Cole", profilePic: null };

function message(id: string, at: Date = NOW): ThreadMessage {
  return { content: `text ${id}`, createdAt: at, id, sender: OTHER };
}

function thread(messages: ThreadMessage[]) {
  return {
    _count: { messages: messages.length },
    id: THREAD,
    messages,
    participants: [
      { ...OTHER, photographer: null },
      { firstName: "Me", id: ME, lastName: "Self", photographer: null, profilePic: null },
    ],
  } as never;
}

type MarkRead = NonNullable<NonNullable<TrpcHandlers["message"]>["markThreadRead"]>;

function renderFeed(markThreadRead: MarkRead, messages = [message("m1")]) {
  return renderWithProviders(<MessageFeed threadId={THREAD} initialThread={thread(messages)} />, {
    trpc: {
      discover: {
        getMatchById: () => null as never,
        getMatches: () => [] as never,
      },
      message: {
        getThreadById: () => thread(messages),
        markThreadRead,
      },
    },
  });
}

const ok = () => ({ lastReadAt: NOW, threadId: THREAD });

/** Moves the fake clock and runs whatever came due, as React work. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Lets pending queries, mutations and zero-delay timers settle. The fake
 * clock runs a zero-delay timeout 1 ms later, so this moves time by a few
 * milliseconds.
 */
async function settle() {
  for (let i = 0; i < 5; i++) await advance(1);
}

/** Past the on-screen delay, then settled. */
async function dwell() {
  await advance(MARK_READ_DELAY_MS);
  await settle();
}

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "Date"] });
  testSession.signIn(ME);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MessageFeed marks the thread read", () => {
  it("up to the newest message once it has been on screen, not before", async () => {
    const view = renderFeed(ok, [message("m1"), message("m2")]);
    await settle();
    await advance(MARK_READ_DELAY_MS - 50);
    expect(view.callsTo("message.markThreadRead")).toEqual([]);

    await dwell();
    expect(view.callsTo("message.markThreadRead")).toEqual([{ threadId: THREAD, upToMessageId: "m2" }]);
  });

  it("does not send the same message twice", async () => {
    const view = renderFeed(ok);
    await dwell();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await dwell();
    await advance(60 * SECOND);

    expect(view.callsTo("message.markThreadRead")).toHaveLength(1);
  });

  it("waits while the tab is hidden and marks it read once the tab is shown", async () => {
    visibility = "hidden";
    const view = renderFeed(ok);
    await dwell();
    await advance(60 * SECOND);
    expect(view.callsTo("message.markThreadRead")).toEqual([]);

    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await dwell();
    expect(view.callsTo("message.markThreadRead")).toEqual([{ threadId: THREAD, upToMessageId: "m1" }]);
  });

  it("marks a message that arrives over the socket", async () => {
    const view = renderFeed(ok);
    await dwell();
    await act(async () => {
      realtime.onMessage?.(message("m2", new Date(NOW.getTime() + SECOND)));
    });
    await dwell();

    expect(view.callsTo("message.markThreadRead")).toEqual([
      { threadId: THREAD, upToMessageId: "m1" },
      { threadId: THREAD, upToMessageId: "m2" },
    ]);
  });

  it("retries a failed call after 5 s, then stops once it succeeds", async () => {
    let calls = 0;
    const view = renderFeed(() => {
      calls += 1;
      if (calls === 1) throw trpcError("INTERNAL_SERVER_ERROR");
      return ok();
    });
    await dwell();
    expect(calls).toBe(1);

    // The retry re-arms the on-screen delay.
    await advance(5 * SECOND - 100);
    expect(calls).toBe(1);
    await advance(100);
    await dwell();
    expect(calls).toBe(2);
    expect(view.callsTo("message.markThreadRead")[1]).toEqual({ threadId: THREAD, upToMessageId: "m1" });

    await advance(10 * 60 * SECOND);
    expect(calls).toBe(2);
  });

  it(`backs off (5, 10, 20, 40, 60, 60 s) and gives up after ${MARK_READ_MAX_RETRIES} retries`, async () => {
    let calls = 0;
    renderFeed(() => {
      calls += 1;
      throw trpcError("INTERNAL_SERVER_ERROR");
    });
    await dwell();
    expect(calls).toBe(1);

    for (const [i, delaySeconds] of [5, 10, 20, 40, 60, 60].entries()) {
      await advance(delaySeconds * SECOND - 100);
      expect(calls, `retry ${i + 1} before ${delaySeconds} s`).toBe(1 + i);
      await advance(100);
      await dwell();
      expect(calls, `retry ${i + 1} after ${delaySeconds} s`).toBe(2 + i);
    }

    await advance(10 * 60 * SECOND);
    expect(calls).toBe(1 + MARK_READ_MAX_RETRIES);
  });

  it("does not let an older request failing late cancel the newer one's retry", async () => {
    let failFirst: (() => void) | undefined;
    const inputs: (string | undefined)[] = [];
    renderFeed((input) => {
      inputs.push(input.upToMessageId);
      if (input.upToMessageId === "m1") {
        return new Promise((_resolve, reject) => {
          failFirst = () => reject(trpcError("INTERNAL_SERVER_ERROR"));
        });
      }
      // The newer call fails once, then succeeds.
      if (inputs.filter((id) => id === "m2").length === 1) throw trpcError("INTERNAL_SERVER_ERROR");
      return ok();
    });
    await dwell();
    expect(inputs).toEqual(["m1"]);

    // A new message arrives while the first call is pending; its call fails.
    await act(async () => {
      realtime.onMessage?.(message("m2", new Date(NOW.getTime() + SECOND)));
    });
    await dwell();
    expect(inputs).toEqual(["m1", "m2"]);

    // Now the first one fails too. It is not the latest attempt: it must
    // neither schedule a retry of its own nor clear the one for m2.
    await act(async () => {
      failFirst?.();
    });
    await settle();
    await advance(5 * SECOND);
    await dwell();
    expect(inputs).toEqual(["m1", "m2", "m2"]);

    await advance(5 * 60 * SECOND);
    expect(inputs).toEqual(["m1", "m2", "m2"]);
  });
});
