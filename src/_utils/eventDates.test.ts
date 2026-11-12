import dayjs from "dayjs";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));

import { eventDateInput } from "~/server/api/routers/event";

import { EVENT_DATE_FORMAT, defaultEventStart, eventDateError, latestEventStart } from "./eventDates";

describe("a new event's default date", () => {
  // Late evening and just before midnight are where "tomorrow" is easiest to get wrong.
  const moments = [new Date(2026, 10, 12, 9, 0), new Date(2026, 10, 12, 23, 59, 59), new Date(2026, 11, 31, 23, 30)];

  it("is tomorrow at 10:00, never now", () => {
    expect(defaultEventStart(new Date(2026, 10, 12, 23, 59, 59))).toBe("2026-11-13 10:00:00");
    expect(defaultEventStart(new Date(2026, 11, 31, 23, 30))).toBe("2027-01-01 10:00:00");
  });

  it("passes the form's own check", () => {
    for (const now of moments) expect(eventDateError(defaultEventStart(now), now)).toBeNull();
  });

  it("passes the server's rule, as the form sends it", () => {
    for (const now of moments) {
      vi.setSystemTime(now);
      // What the form submits: the picked local time as an ISO timestamp.
      expect(eventDateInput.safeParse(dayjs(defaultEventStart(now)).toISOString()).success).toBe(true);
    }
    vi.useRealTimers();
  });

  it("still refuses a time that has passed, or none", () => {
    const now = new Date(2026, 10, 12, 12, 0);
    expect(eventDateError("2026-11-12 11:59:00", now)).toBe("Choose a date and time in the future");
    expect(eventDateError(null, now)).toBe("Choose a date and time");
    expect(eventDateError("not a date", now)).toBe("Choose a date and time");
  });

  it("accepts up to five years ahead and refuses one minute more, as the server does", () => {
    const now = new Date(2026, 10, 12, 12, 0);
    vi.setSystemTime(now);
    const latest = dayjs(latestEventStart(now));
    const oneMore = latest.add(1, "minute");
    // The form's check (and the picker's maxDate, which is this same moment).
    expect(eventDateError(latest.format(EVENT_DATE_FORMAT), now)).toBeNull();
    expect(eventDateError(oneMore.format(EVENT_DATE_FORMAT), now)).toBe("Choose a date within the next five years");
    // The server's rule, at the same moment.
    expect(eventDateInput.safeParse(latest.toISOString()).success).toBe(true);
    expect(eventDateInput.safeParse(oneMore.toISOString()).success).toBe(false);
    vi.useRealTimers();
  });
});
