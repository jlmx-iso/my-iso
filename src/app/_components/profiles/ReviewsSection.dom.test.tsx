// @vitest-environment happy-dom
//
// The review section of a photographer's profile: the form only for a
// signed-in member whose review the server would accept, their own review or
// the reason otherwise, nothing asked for visitors and the owner, and an
// error with a working "Try again" when eligibility fails to load.

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";

import ReviewsSection, { type ReviewViewer } from "./ReviewsSection";

type ReviewState = ReturnType<NonNullable<NonNullable<TrpcHandlers["review"]>["getMyReviewState"]>>;

const ELIGIBLE = { blocker: null, canReview: true, hasReviewed: false, myReview: null };
const ERROR_TEXT = "We could not check whether you can review this photographer.";

function renderSection(viewer: ReviewViewer, getMyReviewState: () => ReviewState) {
  return renderWithProviders(
    <ReviewsSection photographerId="ph-1" photographerName="Ann Lee" viewer={viewer} signInHref="/login?next=x" />,
    {
      trpc: {
        review: {
          getAverageRating: () => ({ average: 0, count: 0 }),
          getMyReviewState,
          getPageByPhotographerId: () => ({ items: [], nextCursor: null }),
        },
      },
    },
  );
}

describe("review eligibility", () => {
  it("shows the form to a member the server would accept", async () => {
    const view = renderSection("member", () => ELIGIBLE);

    expect(await screen.findByRole("button", { name: "Post review" })).toBeTruthy();
    expect(view.callsTo("review.getMyReviewState")).toEqual([{ photographerId: "ph-1" }]);
  });

  it("says why instead of showing the form", async () => {
    renderSection("member", () => ({ ...ELIGIBLE, blocker: "no_completed_booking", canReview: false }));

    expect(
      await screen.findByText("You can review Ann Lee after you've completed a booking together."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Post review" })).toBeNull();
  });

  it("shows the member's own review instead of a form that would be refused", async () => {
    renderSection("member", () => ({
      blocker: "already_reviewed",
      canReview: false,
      hasReviewed: true,
      myReview: { createdAt: new Date("2030-01-02T00:00:00Z"), description: null, id: "rv-1", rating: 4, title: "Great second" },
    }));

    expect(await screen.findByText("Great second")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Post review" })).toBeNull();
  });

  it.each(["anonymous", "owner"] as const)("asks nothing and offers no form to the %s", async (viewer) => {
    const view = renderSection(viewer, () => ELIGIBLE);

    expect(await screen.findByRole("heading", { name: "Reviews" })).toBeTruthy();
    await waitFor(() => expect(view.callsTo("review.getAverageRating")).toHaveLength(1));
    expect(view.callsTo("review.getMyReviewState")).toEqual([]);
    expect(screen.queryByRole("button", { name: "Post review" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign in" }) !== null).toBe(viewer === "anonymous");
  });

  it("says so when eligibility fails to load, and Try again recovers to the real gate", async () => {
    let attempts = 0;
    const view = renderSection("member", () => {
      attempts += 1;
      if (attempts === 1) throw trpcError("INTERNAL_SERVER_ERROR", "database unavailable");
      return { ...ELIGIBLE, blocker: "no_completed_booking", canReview: false };
    });

    expect(await screen.findByText(ERROR_TEXT)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Post review" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByText("You can review Ann Lee after you've completed a booking together."),
    ).toBeTruthy();
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
    expect(view.callsTo("review.getMyReviewState")).toHaveLength(2);
  });

  it("keeps the error and Try again after a retry that fails again", async () => {
    let attempts = 0;
    renderSection("member", () => {
      attempts += 1;
      throw trpcError("INTERNAL_SERVER_ERROR", "still down");
    });

    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => expect(attempts).toBe(2));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Post review" })).toBeNull();
  });
});
