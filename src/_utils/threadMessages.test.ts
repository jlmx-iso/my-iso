import { describe, expect, it } from "vitest";

import { mergeThreadMessages, parseThreadMessageEvent } from "./threadMessages";

const sender = { firstName: "Sarah", id: "user-1", lastName: "Chen", profilePic: null };

function message(id: string, createdAt: string, content = id) {
  return { content, createdAt: new Date(createdAt), id, sender };
}

describe("mergeThreadMessages", () => {
  it("appends a new message after the existing history", () => {
    const merged = mergeThreadMessages(
      [message("a", "2026-01-01T10:00:00Z"), message("b", "2026-01-01T10:01:00Z")],
      [message("c", "2026-01-01T10:02:00Z")],
    );

    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps one copy of a message that arrives twice", () => {
    const existing = [message("a", "2026-01-01T10:00:00Z")];
    const merged = mergeThreadMessages(existing, [
      message("a", "2026-01-01T10:00:00Z", "edited"),
      message("a", "2026-01-01T10:00:00Z", "edited"),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.content).toBe("edited");
  });

  it("orders by createdAt regardless of arrival order", () => {
    const merged = mergeThreadMessages(
      [message("late", "2026-01-01T10:05:00Z")],
      [message("early", "2026-01-01T10:00:00Z")],
    );

    expect(merged.map((m) => m.id)).toEqual(["early", "late"]);
  });

  it("orders messages with the same timestamp deterministically", () => {
    const at = "2026-01-01T10:00:00Z";

    expect(mergeThreadMessages([message("b", at)], [message("a", at)]).map((m) => m.id))
      .toEqual(["a", "b"]);
    expect(mergeThreadMessages([message("a", at)], [message("b", at)]).map((m) => m.id))
      .toEqual(["a", "b"]);
  });

  it("does not mutate its inputs", () => {
    const existing = [message("b", "2026-01-01T10:01:00Z")];
    const incoming = [message("a", "2026-01-01T10:00:00Z")];

    mergeThreadMessages(existing, incoming);

    expect(existing.map((m) => m.id)).toEqual(["b"]);
    expect(incoming.map((m) => m.id)).toEqual(["a"]);
  });
});

describe("parseThreadMessageEvent", () => {
  const frame = {
    message: { content: "hello", createdAt: "2026-01-01T10:00:00.000Z", id: "m1", sender },
    type: "message",
  };

  it("parses a message event and revives createdAt as a Date", () => {
    const parsed = parseThreadMessageEvent(JSON.stringify(frame));

    expect(parsed).toEqual({
      content: "hello",
      createdAt: new Date("2026-01-01T10:00:00.000Z"),
      id: "m1",
      sender,
    });
  });

  it.each([
    ["binary data", new ArrayBuffer(4)],
    ["malformed JSON", "{not json"],
    ["an unknown event type", JSON.stringify({ ...frame, type: "typing" })],
    ["a message without an id", JSON.stringify({ ...frame, message: { ...frame.message, id: "" } })],
    ["an invalid date", JSON.stringify({ ...frame, message: { ...frame.message, createdAt: "yesterday" } })],
  ])("returns null for %s", (_label, data) => {
    expect(parseThreadMessageEvent(data)).toBeNull();
  });
});
