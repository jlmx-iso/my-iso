import { describe, expect, it } from "vitest";

import { applyButtonState } from "./applyButton";

describe("applyButtonState", () => {
  it("offers a first application while the event takes applications", () => {
    expect(applyButtonState({ applyBlockedBy: null, hasApplied: false })).toEqual({ kind: "apply", label: "I'm Interested" });
  });

  it("shows a standing (or declined) application as Applied, whatever the event's state", () => {
    for (const applyBlockedBy of [null, "event_filled", "event_started"] as const) {
      expect(applyButtonState({ applyBlockedBy, canReapply: false, hasApplied: true })).toEqual({ kind: "disabled", label: "Applied" });
    }
  });

  it("offers Apply again after a withdrawal only while the event still takes applications", () => {
    const withdrawn = { canReapply: true, hasApplied: true };

    expect(applyButtonState({ ...withdrawn, applyBlockedBy: null })).toEqual({ kind: "apply", label: "Apply again" });
    expect(applyButtonState({ ...withdrawn, applyBlockedBy: "event_filled" })).toEqual({ kind: "disabled", label: "Position filled" });
    expect(applyButtonState({ ...withdrawn, applyBlockedBy: "event_started" })).toEqual({ kind: "disabled", label: "Event has started" });
    expect(applyButtonState({ ...withdrawn, applyBlockedBy: "event_not_found" })).toEqual({ kind: "disabled", label: "No longer available" });
  });

  it("does not offer a first application to an event that is filled or has started", () => {
    expect(applyButtonState({ applyBlockedBy: "event_filled", hasApplied: false })).toEqual({ kind: "disabled", label: "Position filled" });
    expect(applyButtonState({ applyBlockedBy: "event_started", hasApplied: false })).toEqual({ kind: "disabled", label: "Event has started" });
  });

  it("treats an answer without the field (an older server) as open", () => {
    expect(applyButtonState({ hasApplied: false })).toEqual({ kind: "apply", label: "I'm Interested" });
  });
});
