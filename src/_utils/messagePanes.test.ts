import { describe, expect, it } from "vitest";

import {
  activeMessagePane,
  defaultThreadRedirect,
  selectedThreadId,
  sortThreadsByRecency,
} from "./messagePanes";

const thread = (id: string, at: string | null) => ({
  id,
  lastMessage: at ? { createdAt: new Date(at) } : null,
});

describe("activeMessagePane", () => {
  it("shows the list on /app/messages (no child segment)", () => {
    expect(activeMessagePane(null)).toBe("list");
  });

  it("shows the thread on /app/messages/[id]", () => {
    expect(activeMessagePane("cmabc123")).toBe("thread");
  });

  it("decodes the selected thread id", () => {
    expect(selectedThreadId("thread%2Fone")).toBe("thread/one");
    expect(selectedThreadId(null)).toBeNull();
  });
});

describe("sortThreadsByRecency", () => {
  it("orders by latest message, newest first, without mutating the input", () => {
    const input = [
      thread("old", "2026-01-01T10:00:00Z"),
      thread("new", "2026-03-01T10:00:00Z"),
      thread("mid", "2026-02-01T10:00:00Z"),
    ];
    expect(sortThreadsByRecency(input).map((t) => t.id)).toEqual(["new", "mid", "old"]);
    expect(input.map((t) => t.id)).toEqual(["old", "new", "mid"]);
  });

  it("puts threads without messages last and keeps ties stable", () => {
    const input = [
      thread("empty", null),
      thread("a", "2026-01-01T10:00:00Z"),
      thread("b", "2026-01-01T10:00:00Z"),
    ];
    expect(sortThreadsByRecency(input).map((t) => t.id)).toEqual(["a", "b", "empty"]);
  });

  it("moves a thread to the top when a newer message arrives", () => {
    const before = [thread("a", "2026-03-01T10:00:00Z"), thread("b", "2026-02-01T10:00:00Z")];
    const after = before.map((t) => (t.id === "b" ? thread("b", "2026-03-02T09:00:00Z") : t));
    expect(sortThreadsByRecency(after).map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("defaultThreadRedirect", () => {
  const threads = [thread("old", "2026-01-01T10:00:00Z"), thread("new", "2026-03-01T10:00:00Z")];
  const base = { hasNewMessageDeepLink: false, isWideScreen: true, selectedSegment: null, threads };

  it("opens the most recent thread on a wide screen", () => {
    expect(defaultThreadRedirect(base)).toBe("/app/messages/new");
  });

  it("stays on the list on a phone", () => {
    expect(defaultThreadRedirect({ ...base, isWideScreen: false })).toBeNull();
  });

  it("does nothing when a thread is already selected, a composer deep link is open, or there are no threads", () => {
    expect(defaultThreadRedirect({ ...base, selectedSegment: "old" })).toBeNull();
    expect(defaultThreadRedirect({ ...base, hasNewMessageDeepLink: true })).toBeNull();
    expect(defaultThreadRedirect({ ...base, threads: [] })).toBeNull();
  });
});
