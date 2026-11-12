import { describe, expect, it } from "vitest";

import { memberReviewView, reviewGate } from "./reviewGate";

const review = { createdAt: new Date("2026-06-01T10:00:00Z"), description: null, id: "r1", rating: 5, title: "Great" };
const state = (overrides: Partial<Parameters<typeof reviewGate>[0]>): Parameters<typeof reviewGate>[0] => ({
  blocker: null,
  canReview: true,
  hasReviewed: false,
  myReview: null,
  ...overrides,
});

describe("reviewGate", () => {
  it("shows the form only when the server would accept a review", () => {
    expect(reviewGate(state({}), "Ada")).toEqual({ kind: "form" });
  });

  it("shows the viewer's own review instead of the form", () => {
    const gate = reviewGate(
      state({ blocker: "already_reviewed", canReview: false, hasReviewed: true, myReview: review }),
      "Ada",
    );
    expect(gate).toEqual({ kind: "own", review });
  });

  it("explains in one line why someone who has not worked with them cannot review", () => {
    const gate = reviewGate(state({ blocker: "no_completed_booking", canReview: false }), "Ada");
    expect(gate).toEqual({
      kind: "blocked",
      message: "You can review Ada after you've completed a booking together.",
    });
  });

  it("has a line for the other blockers too", () => {
    expect(reviewGate(state({ blocker: "self", canReview: false }), "Ada")).toEqual({
      kind: "blocked",
      message: "You can't review your own profile.",
    });
    // Reviewed, but the review itself did not come back.
    expect(reviewGate(state({ blocker: "already_reviewed", canReview: false, hasReviewed: true }), "Ada")).toEqual({
      kind: "blocked",
      message: "You've already reviewed Ada.",
    });
  });

  it("never shows the form when the server says no, even without a reason", () => {
    expect(reviewGate(state({ canReview: false }), "Ada")).toEqual({ kind: "none" });
  });
});

describe("memberReviewView", () => {
  it("is an error, not silence, when eligibility fails to load", () => {
    expect(memberReviewView({ isError: true }, "Ada")).toEqual({ kind: "error" });
  });

  it("is loading until the server answers", () => {
    expect(memberReviewView({ isError: false }, "Ada")).toEqual({ kind: "loading" });
  });

  it("keeps an answer it already has when a later refetch fails", () => {
    expect(memberReviewView({ data: state({}), isError: true }, "Ada")).toEqual({ kind: "form" });
  });
});
