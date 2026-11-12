import { describe, expect, it } from "vitest";

import { canonicalTimeZone, eventDay, formatEventTime, isValidTimeZone, localTimeZone, timeZoneLabel } from "./eventTime";

// 2 PM in Denver (MST, UTC-7) on Sunday, November 22, 2026.
const START = new Date("2026-11-22T21:00:00.000Z");

describe("formatEventTime", () => {
  it("writes the time in the event's zone, labelled with it", () => {
    expect(formatEventTime(START, "America/Denver")).toBe("Sun, Nov 22 · 2:00 PM MST");
    expect(formatEventTime(START, "America/Denver", "dateTime")).toBe("Nov 22, 2026 · 2:00 PM MST");
    expect(formatEventTime(START, "America/Denver", "date")).toBe("Nov 22, 2026");
    expect(formatEventTime(START, "America/Denver", "time")).toBe("2:00 PM MST");
  });

  it("does not convert to another zone: the same instant reads differently per event zone", () => {
    expect(formatEventTime(START, "America/New_York", "time")).toBe("4:00 PM EST");
    // Summer time is named as such.
    expect(formatEventTime("2027-07-04T21:00:00.000Z", "America/Denver", "time")).toBe("3:00 PM MDT");
    // The day can differ too.
    expect(formatEventTime("2026-11-23T03:00:00.000Z", "America/Los_Angeles", "date")).toBe("Nov 22, 2026");
  });

  it("uses the reader's zone, labelled, for an event without one (the tests run in UTC)", () => {
    expect(formatEventTime(START, null)).toBe("Sun, Nov 22 · 9:00 PM UTC");
    expect(formatEventTime(START, "Not/AZone")).toBe("Sun, Nov 22 · 9:00 PM UTC");
    expect(formatEventTime(START.toISOString(), undefined, "time")).toBe("9:00 PM UTC");
  });

  it("is empty for a missing or invalid date", () => {
    expect(formatEventTime(null, "America/Denver")).toBe("");
    expect(formatEventTime(undefined, "America/Denver")).toBe("");
    expect(formatEventTime("", "America/Denver")).toBe("");
    expect(formatEventTime("not a date", "America/Denver")).toBe("");
  });
});

describe("eventDay", () => {
  it("gives month, day and weekday in the event's zone", () => {
    expect(eventDay(START, "America/Denver")).toEqual({ day: "22", month: "Nov", weekday: "Sun" });
    expect(eventDay("2026-11-23T03:00:00.000Z", "America/Los_Angeles")).toEqual({ day: "22", month: "Nov", weekday: "Sun" });
    expect(eventDay("nope", "America/Denver")).toBeNull();
  });
});

describe("time zones", () => {
  it("knows IANA zones and refuses anything else", () => {
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });

  it("canonicalises named zones and refuses offsets and unknown names", () => {
    expect(canonicalTimeZone("america/new_york")).toBe("America/New_York");
    expect(canonicalTimeZone(" Europe/Paris ")).toBe("Europe/Paris");
    expect(canonicalTimeZone("UTC")).toBe("UTC");
    expect(canonicalTimeZone("+01:00")).toBeNull();
    expect(canonicalTimeZone("-0500")).toBeNull();
    expect(canonicalTimeZone("Mars/Base")).toBeNull();
    expect(canonicalTimeZone(null)).toBeNull();
  });

  it("names the local zone and a zone's short label", () => {
    expect(localTimeZone()).toBe("UTC");
    expect(timeZoneLabel(START, "America/Chicago")).toBe("CST");
    expect(timeZoneLabel(START, null)).toBe("UTC");
    expect(timeZoneLabel(new Date("x"), "America/Chicago")).toBe("");
  });
});
