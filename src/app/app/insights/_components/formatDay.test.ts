import { describe, expect, it } from "vitest";

import { formatUtcDay } from "./formatDay";

describe("formatUtcDay", () => {
  it("names the stored UTC day, whatever the viewer's time zone", () => {
    expect(formatUtcDay("2030-06-15")).toBe("Jun 15");
    expect(formatUtcDay("2030-01-01")).toBe("Jan 1");
  });

  it("returns anything that is not a day as it is", () => {
    expect(formatUtcDay("not-a-day")).toBe("not-a-day");
  });
});
