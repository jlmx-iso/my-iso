import { describe, expect, it } from "vitest";

import { partitionEventsByDate } from "./eventFeed";

const now = new Date("2026-06-15T12:00:00Z");
const event = (id: string, date: string) => ({ date: new Date(date), id });

describe("partitionEventsByDate", () => {
  const events = [
    event("far", "2026-12-01T10:00:00Z"),
    event("soon", "2026-06-16T10:00:00Z"),
    event("yesterday", "2026-06-14T10:00:00Z"),
    event("last-year", "2025-06-14T10:00:00Z"),
  ];

  it("lists upcoming events soonest first", () => {
    expect(partitionEventsByDate(events, now).upcoming.map((e) => e.id)).toEqual(["soon", "far"]);
  });

  it("lists past events most recent first", () => {
    expect(partitionEventsByDate(events, now).past.map((e) => e.id)).toEqual(["yesterday", "last-year"]);
  });

  it("treats an event starting right now as upcoming and accepts ISO strings", () => {
    const result = partitionEventsByDate(
      [{ date: now.toISOString(), id: "now" }, { date: "2026-06-15T11:59:59Z", id: "just-missed" }],
      now,
    );
    expect(result.upcoming.map((e) => e.id)).toEqual(["now"]);
    expect(result.past.map((e) => e.id)).toEqual(["just-missed"]);
  });

  it("does not mutate its input", () => {
    const input = [...events];
    partitionEventsByDate(input, now);
    expect(input).toEqual(events);
  });
});
