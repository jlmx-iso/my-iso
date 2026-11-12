import { describe, expect, it } from "vitest";

import { cspModeSchema } from "./cspModeSchema.js";

describe("cspModeSchema", () => {
  it.each([
    [undefined, "enforce"],
    ["enforce", "enforce"],
    ["report-only", "report-only"],
    [" Report-Only ", "report-only"],
    ["ENFORCE", "enforce"],
  ])("reads %j as %s", (value, expected) => {
    expect(cspModeSchema.parse(value)).toBe(expected);
  });

  it.each(["report_only", "off", "", "   ", "reportonly", 1])(
    "enforces for the unrecognised value %j instead of throwing",
    (value) => {
      expect(cspModeSchema.parse(value)).toBe("enforce");
    },
  );
});
