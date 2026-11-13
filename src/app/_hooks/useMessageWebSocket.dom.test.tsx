// @vitest-environment happy-dom
//
// The realtime subscription of an open thread: it connects to the Worker's
// endpoint for that thread, hands every well-formed message to the feed,
// reconnects with capped exponential backoff after a drop or a failed
// handshake, stops for good when the endpoint says the caller may not
// connect (signed out, not a participant, account deleted) or does not
// exist, and leaves nothing behind when it unmounts.
//
// The hook only receives: messages are sent through tRPC (ComposeMessage),
// never over this socket.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLOSE_ACCOUNT_DELETED, CLOSE_SESSION_EXPIRED } from "~/do/chatRoomPolicy";
import { REALTIME_PATH, RECONNECT_MAX_DELAY_MS } from "~/_utils/realtimeConnection";
import type { ThreadMessage } from "~/_utils/threadMessages";

import { useMessageWebSocket } from "./useMessageWebSocket";

/** A WebSocket the test drives: it opens, delivers and closes on request. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onopen: (() => void) | null = null;
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  /** Called by the hook. Like a browser, the close event follows later. */
  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    queueMicrotask(() => this.onclose?.({ code: code ?? 1005 }));
  }

  serverOpen() {
    this.onopen?.();
  }

  serverSend(data: unknown) {
    this.onmessage?.({ data });
  }

  /** The connection ends without the hook asking (drop, refusal, server close). */
  serverClose(code = 1006) {
    this.onclose?.({ code });
  }
}

const THREAD = "thread-1";
const NOW = "2030-06-01T12:00:00.000Z";

const SENDER = { firstName: "Bea", id: "bea", lastName: "Cole", profilePic: null };

function frame(id: string) {
  return JSON.stringify({ message: { content: `hello ${id}`, createdAt: NOW, id, sender: SENDER }, type: "message" });
}

function delivered(id: string): ThreadMessage {
  return { content: `hello ${id}`, createdAt: new Date(NOW), id, sender: SENDER };
}

let probeStatus: number | "network-error";
let probe: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;

const sockets = () => FakeWebSocket.instances;
const latest = () => {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error("No socket was opened");
  return socket;
};

/** Moves the fake clock and lets promises (the probe) settle, as React work. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Runs a server-side event and whatever follows from it, as React work. */
async function server(run: () => void) {
  await act(async () => {
    run();
    await vi.advanceTimersByTimeAsync(0);
  });
}

function renderSocket(threadId = THREAD) {
  const onMessage = vi.fn<(message: ThreadMessage) => void>();
  const onOpen = vi.fn<() => void>();
  const view = renderHook((props: { threadId: string; onMessage: typeof onMessage }) =>
    useMessageWebSocket({ onMessage: props.onMessage, onOpen, threadId: props.threadId }),
  { initialProps: { onMessage, threadId } });
  return { ...view, onMessage, onOpen };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  // No jitter: each reconnect waits exactly the exponential delay.
  vi.spyOn(Math, "random").mockReturnValue(0);
  probeStatus = 500;
  probe = vi.fn((_url: string, init: RequestInit) => {
    if (init.signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    if (probeStatus === "network-error") return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(new Response(null, { status: probeStatus }));
  });
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => probe(String(input), init ?? {}));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useMessageWebSocket", () => {
  it("connects to the thread's realtime endpoint and reports open", async () => {
    const view = renderSocket("thread a/b");
    expect(view.result.current).toBe("connecting");
    expect(sockets()).toHaveLength(1);
    expect(latest().url).toBe(`ws://${window.location.host}${REALTIME_PATH}?threadId=thread%20a%2Fb`);

    await server(() => latest().serverOpen());
    expect(view.result.current).toBe("open");
    expect(view.onOpen).toHaveBeenCalledTimes(1);
  });

  it("hands every well-formed message to the latest onMessage, and ignores anything else", async () => {
    const view = renderSocket();
    await server(() => latest().serverOpen());

    await server(() => latest().serverSend(frame("m1")));
    expect(view.onMessage).toHaveBeenCalledWith(delivered("m1"));

    await server(() => {
      latest().serverSend("not json");
      latest().serverSend(JSON.stringify({ type: "typing" }));
      latest().serverSend(new ArrayBuffer(4));
    });
    expect(view.onMessage).toHaveBeenCalledTimes(1);

    // A new callback is used at once, without reconnecting.
    const next = vi.fn<(message: ThreadMessage) => void>();
    view.rerender({ onMessage: next, threadId: THREAD });
    await server(() => latest().serverSend(frame("m2")));
    expect(next).toHaveBeenCalledWith(delivered("m2"));
    expect(view.onMessage).toHaveBeenCalledTimes(1);
    expect(sockets()).toHaveLength(1);
  });

  it("reconnects after a drop, backing off while attempts fail and starting over once one succeeds", async () => {
    const view = renderSocket();
    await server(() => latest().serverOpen());

    await server(() => latest().serverClose(1006));
    expect(view.result.current).toBe("reconnecting");

    await advance(999);
    expect(sockets()).toHaveLength(1);
    await advance(1);
    expect(sockets()).toHaveLength(2);

    // The second attempt is refused for a passing reason (5xx): try again, later.
    await server(() => latest().serverClose());
    expect(probe).toHaveBeenCalledTimes(1);
    expect(view.result.current).toBe("reconnecting");
    await advance(1999);
    expect(sockets()).toHaveLength(2);
    await advance(1);
    expect(sockets()).toHaveLength(3);

    await server(() => latest().serverOpen());
    expect(view.result.current).toBe("open");
    // Every connection is a chance to catch up on what was missed.
    expect(view.onOpen).toHaveBeenCalledTimes(2);

    // A success resets the backoff.
    await server(() => latest().serverClose(1001));
    await advance(1000);
    expect(sockets()).toHaveLength(4);
  });

  it("never waits more than the maximum delay between attempts", async () => {
    renderSocket();
    // Failed handshakes: 1, 2, 4, 8, 16 s, then capped.
    for (const delay of [1000, 2000, 4000, 8000, 16_000, RECONNECT_MAX_DELAY_MS, RECONNECT_MAX_DELAY_MS]) {
      const before = sockets().length;
      await server(() => latest().serverClose());
      await advance(delay - 1);
      expect(sockets()).toHaveLength(before);
      await advance(1);
      expect(sockets()).toHaveLength(before + 1);
    }
  });

  it("asks the endpoint why a handshake failed, and stops when it was refused", async () => {
    for (const status of [401, 403]) {
      FakeWebSocket.instances = [];
      probe.mockClear();
      probeStatus = status;
      const view = renderSocket();

      await server(() => latest().serverClose());
      expect(probe).toHaveBeenCalledTimes(1);
      const [url, init] = probe.mock.calls[0]!;
      expect(url).toBe(`${REALTIME_PATH}?threadId=${THREAD}`);
      expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
      expect(view.result.current).toBe("denied");

      await advance(5 * RECONNECT_MAX_DELAY_MS);
      expect(sockets()).toHaveLength(1);
      view.unmount();
    }
  });

  it("stops when the deployment has no realtime endpoint", async () => {
    probeStatus = 404;
    const view = renderSocket();
    await server(() => latest().serverClose());
    expect(view.result.current).toBe("unavailable");
    await advance(5 * RECONNECT_MAX_DELAY_MS);
    expect(sockets()).toHaveLength(1);
  });

  it("retries when even the probe fails (offline)", async () => {
    probeStatus = "network-error";
    const view = renderSocket();
    await server(() => latest().serverClose());
    expect(view.result.current).toBe("reconnecting");
    await advance(1000);
    expect(sockets()).toHaveLength(2);
  });

  it("gives up on a handshake that never completes and tries again", async () => {
    const view = renderSocket();
    await advance(9_999);
    expect(latest().closeCalls).toEqual([]);

    await advance(1);
    expect(latest().closeCalls).toHaveLength(1);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(view.result.current).toBe("reconnecting");
    await advance(1000);
    expect(sockets()).toHaveLength(2);
  });

  it.each([
    ["the account was deleted", CLOSE_ACCOUNT_DELETED],
    ["the session ran out", CLOSE_SESSION_EXPIRED],
  ])("stops once the server closed the socket because %s and refuses to let it back in", async (_reason, code) => {
    const view = renderSocket();
    await server(() => latest().serverOpen());

    await server(() => latest().serverClose(code));
    expect(view.result.current).toBe("reconnecting");

    // The gateway finds no session for the next attempt.
    probeStatus = 401;
    await advance(1000);
    expect(sockets()).toHaveLength(2);
    await server(() => latest().serverClose());
    expect(view.result.current).toBe("denied");

    await advance(5 * RECONNECT_MAX_DELAY_MS);
    expect(sockets()).toHaveLength(2);
    expect(view.onOpen).toHaveBeenCalledTimes(1);
  });

  it("closes the socket and leaves no timer, probe or update behind when unmounted", async () => {
    const open = renderSocket();
    await server(() => latest().serverOpen());
    open.unmount();
    expect(latest().closeCalls).toEqual([{ code: 1000, reason: "Unmounted" }]);
    await advance(0);
    expect(vi.getTimerCount()).toBe(0);
    await advance(5 * RECONNECT_MAX_DELAY_MS);
    expect(sockets()).toHaveLength(1);

    // While waiting to reconnect.
    const waiting = renderSocket();
    await server(() => latest().serverOpen());
    await server(() => latest().serverClose());
    expect(vi.getTimerCount()).toBe(1);
    waiting.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await advance(5 * RECONNECT_MAX_DELAY_MS);
    expect(sockets()).toHaveLength(2);

    // While the probe is in flight: it is aborted and its answer ignored.
    let answer: (response: Response) => void = () => undefined;
    probe.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)));
    const probing = renderSocket();
    await server(() => latest().serverClose());
    const signal = probe.mock.calls.at(-1)?.[1].signal;
    probing.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      answer(new Response(null, { status: 500 }));
      await vi.advanceTimersByTimeAsync(5 * RECONNECT_MAX_DELAY_MS);
    });
    expect(sockets()).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("moves to a new thread: the old socket closes, the new thread starts connecting", async () => {
    const view = renderSocket("thread-1");
    await server(() => latest().serverOpen());
    const first = latest();

    view.rerender({ onMessage: view.onMessage, threadId: "thread-2" });
    expect(view.result.current).toBe("connecting");
    expect(first.closeCalls).toEqual([{ code: 1000, reason: "Unmounted" }]);
    expect(latest().url).toContain("threadId=thread-2");

    await server(() => latest().serverOpen());
    expect(view.result.current).toBe("open");
    await advance(5 * RECONNECT_MAX_DELAY_MS);
    expect(sockets()).toHaveLength(2);
  });
});
