import { describe, expect, it } from "vitest";

import {
  canonicalTimeZone,
  dateToZonedWallTime,
  eventDay,
  formatEventTime,
  isValidTimeZone,
  localTimeZone,
  timeZoneChoices,
  timeZoneLabel,
  zonedWallTimeToDate,
} from "./eventTime";

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

  it("uses the reader's zone, labelled as theirs, for an event without one (the tests run in UTC)", () => {
    expect(formatEventTime(START, null)).toBe("Sun, Nov 22 · 9:00 PM UTC (your time)");
    expect(formatEventTime(START, "Not/AZone")).toBe("Sun, Nov 22 · 9:00 PM UTC (your time)");
    expect(formatEventTime(START.toISOString(), undefined, "time")).toBe("9:00 PM UTC (your time)");
    expect(formatEventTime(START, null, "weekdayDate", { now: new Date("2026-03-01T12:00:00Z") })).toBe("Sun, Nov 22");
    // Another year: said, so "Sun, Nov 22" is not taken for this one.
    expect(formatEventTime(START, null, "weekdayDate", { now: new Date("2025-12-31T12:00:00Z") })).toBe("Sun, Nov 22, 2026");
  });

  it("can leave the zone out when it shows the reader's clock", () => {
    const listed = { zone: "when-different" } as const;
    expect(formatEventTime(START, "America/Denver", "time", listed)).toBe("2:00 PM MST");
    expect(formatEventTime(START, "Europe/London", "time", listed)).toBe("9:00 PM");
    expect(formatEventTime(START, null, "time", listed)).toBe("9:00 PM");
  });

  it("is empty for a missing or invalid date", () => {
    expect(formatEventTime(null, "America/Denver")).toBe("");
    expect(formatEventTime(undefined, "America/Denver")).toBe("");
    expect(formatEventTime("", "America/Denver")).toBe("");
    expect(formatEventTime("not a date", "America/Denver")).toBe("");
  });
});

describe("wall-clock times in a zone", () => {
  it("turns the picker's clock time in a zone into the instant, and back", () => {
    expect(zonedWallTimeToDate("2026-11-22 14:00:00", "America/Denver")?.toISOString()).toBe(START.toISOString());
    expect(zonedWallTimeToDate("2027-07-04 15:00", "America/Denver")?.toISOString()).toBe("2027-07-04T21:00:00.000Z");
    expect(dateToZonedWallTime(START, "America/Denver")).toBe("2026-11-22 14:00:00");
    expect(dateToZonedWallTime(START.toISOString(), "Asia/Tokyo")).toBe("2026-11-23 06:00:00");
    // No zone: the browser's (UTC in the tests).
    expect(dateToZonedWallTime(START, null)).toBe("2026-11-22 21:00:00");
  });

  it("gets daylight saving right on the day it changes", () => {
    // March 14, 2027: Denver goes from MST (-7) to MDT (-6) at 2 AM.
    expect(zonedWallTimeToDate("2027-03-14 01:30:00", "America/Denver")?.toISOString()).toBe("2027-03-14T08:30:00.000Z");
    expect(zonedWallTimeToDate("2027-03-14 10:00:00", "America/Denver")?.toISOString()).toBe("2027-03-14T16:00:00.000Z");
  });

  it("refuses an unreadable time or zone", () => {
    expect(zonedWallTimeToDate("tomorrow", "America/Denver")).toBeNull();
    expect(zonedWallTimeToDate(null, "America/Denver")).toBeNull();
    expect(zonedWallTimeToDate("2026-11-22 14:00:00", "Mars/Base")).toBeNull();
    expect(dateToZonedWallTime("nope", "America/Denver")).toBe("");
  });
});

describe("timeZoneChoices", () => {
  it("lists common zones first, with the ones asked for, then travel destinations, each once", () => {
    const [common, all] = timeZoneChoices(["Europe/Berlin", null, "Mars/Base"], START);
    expect(common?.group).toBe("Common");
    expect(common?.items[0]).toEqual({ label: "Europe/Berlin (GMT+1)", value: "Europe/Berlin" });
    expect(common?.items.map((item) => item.value)).toContain("America/Los_Angeles");
    expect(common?.items.map((item) => item.value)).not.toContain("Mars/Base");
    expect(common?.items.find((item) => item.value === "America/Los_Angeles")?.label).toBe("America/Los Angeles (PST)");
    const values = [...(common?.items ?? []), ...(all?.items ?? [])].map((item) => item.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain("Asia/Tokyo");
    expect(all?.group).toBe("Elsewhere");
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
    expect(canonicalTimeZone("Etc/GMT+5")).toBeNull();
    expect(canonicalTimeZone("etc/gmt-1")).toBeNull();
    expect(canonicalTimeZone("Etc/UTC")).toBe("UTC");
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
