import { describe, expect, it } from "vitest";

import { ICEBREAKER_POLL_MS, ICEBREAKER_WAIT_MS, icebreakerPollInterval, icebreakerView } from "./icebreakers";

describe("icebreakerPollInterval", () => {
  it("polls gently while suggestions are pending", () => {
    expect(icebreakerPollInterval("pending", 0)).toBe(ICEBREAKER_POLL_MS);
    expect(ICEBREAKER_POLL_MS).toBeGreaterThanOrEqual(3_000);
  });

  it("stops after a short while", () => {
    expect(icebreakerPollInterval("pending", ICEBREAKER_WAIT_MS - 1)).toBe(ICEBREAKER_POLL_MS);
    expect(icebreakerPollInterval("pending", ICEBREAKER_WAIT_MS)).toBe(false);
    expect(ICEBREAKER_WAIT_MS).toBeLessThanOrEqual(30_000);
  });

  it("never polls once ready, when unavailable, or before the first answer", () => {
    expect(icebreakerPollInterval("ready", 0)).toBe(false);
    expect(icebreakerPollInterval("unavailable", 0)).toBe(false);
    expect(icebreakerPollInterval(undefined, 0)).toBe(false);
  });
});

describe("icebreakerView", () => {
  it("shows the suggestions when they are ready", () => {
    expect(icebreakerView({ icebreakers: [" Ask about Big Sur ", ""], icebreakersStatus: "ready" }, 0)).toEqual({
      kind: "ready",
      suggestions: ["Ask about Big Sur"],
    });
  });

  it("says they are on their way while pending, then gives up quietly", () => {
    const pending = { icebreakers: [], icebreakersStatus: "pending" };
    expect(icebreakerView(pending, 0)).toEqual({ kind: "pending" });
    expect(icebreakerView(pending, ICEBREAKER_WAIT_MS)).toEqual({ kind: "hidden" });
  });

  it("shows nothing when unavailable, not loaded, or ready but empty", () => {
    expect(icebreakerView({ icebreakers: [], icebreakersStatus: "unavailable" }, 0)).toEqual({ kind: "hidden" });
    expect(icebreakerView(undefined, 0)).toEqual({ kind: "hidden" });
    expect(icebreakerView({ icebreakers: [], icebreakersStatus: "ready" }, 0)).toEqual({ kind: "hidden" });
    // A server that does not send a status yet.
    expect(icebreakerView({ icebreakers: ["Hi"] }, 0)).toEqual({ kind: "hidden" });
  });
});
