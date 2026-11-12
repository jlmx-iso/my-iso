import { describe, expect, it } from "vitest";

import { DATE_FORMATS, formatDate, formatRelative } from "./dayjs";

// Built from local parts so the expectations hold in any time zone.
const moment = new Date(2026, 5, 14, 15, 30);

describe("formatDate", () => {
  it("writes each named format", () => {
    expect(formatDate(moment)).toBe("Jun 14, 2026");
    expect(formatDate(moment, "date")).toBe("Jun 14, 2026");
    expect(formatDate(moment, "dateLong")).toBe("June 14, 2026");
    expect(formatDate(moment, "dateTime")).toBe("Jun 14, 2026 3:30 PM");
    expect(formatDate(moment, "dayTime")).toBe("Sun, Jun 14 · 3:30 PM");
    expect(formatDate(moment, "time")).toBe("3:30 PM");
  });

  it("accepts ISO strings and timestamps as well as dates", () => {
    expect(formatDate(moment.toISOString(), "dateTime")).toBe("Jun 14, 2026 3:30 PM");
    expect(formatDate(moment.getTime(), "dateTime")).toBe("Jun 14, 2026 3:30 PM");
  });

  it("returns an empty string for a missing or unparseable date", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate("not a date")).toBe("");
  });

  it("has no two names for the same format", () => {
    const patterns = Object.values(DATE_FORMATS);
    expect(new Set(patterns).size).toBe(patterns.length);
  });
});

describe("formatRelative", () => {
  it("describes a moment relative to another", () => {
    const now = new Date(2026, 5, 14, 17, 30);
    expect(formatRelative(moment, now)).toBe("2 hours ago");
    expect(formatRelative(new Date(2026, 5, 17, 17, 30), now)).toBe("in 3 days");
  });

  it("returns an empty string for a missing or unparseable date", () => {
    expect(formatRelative(null)).toBe("");
    expect(formatRelative("nope")).toBe("");
  });
});
