// @vitest-environment happy-dom
//
// The photographer profile's review section: the form only for a signed-in
// viewer whose review would be accepted, the reason otherwise, and an error
// with a working "Try again" when eligibility could not be loaded.

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import { testSession } from "~/test/dom/session";

vi.mock("next-auth/react", () => import("~/test/dom/session"));
vi.mock("next/navigation", () => ({ useParams: () => ({ handle: "ann" }) }));

import PhotographerProfilePage from "./page";

const PHOTOGRAPHER = {
  avatar: null,
  bio: null,
  companyName: "Ann Lee Photo",
  facebook: null,
  id: "ph-1",
  instagram: null,
  location: "Austin, TX",
  name: "Ann Lee",
  tiktok: null,
  twitter: null,
  userId: "ann",
  vimeo: null,
  website: null,
  youtube: null,
};

const ELIGIBLE = { blocker: null, canReview: true, hasReviewed: false, myReview: null };

function handlers(getMyReviewState: NonNullable<TrpcHandlers["review"]>["getMyReviewState"]): TrpcHandlers {
  return {
    photographer: {
      getByUsername: () => PHOTOGRAPHER,
      getPortfolioImages: () => [],
    },
    review: {
      getAverageRating: () => ({ average: 0, count: 0 }),
      getByPhotographerId: () => [],
      getMyReviewState,
    },
  };
}

const ERROR_TEXT = "We could not check whether you can review this photographer.";

beforeEach(() => {
  testSession.signIn("viewer");
});

describe("review eligibility on the photographer profile", () => {
  it("shows the form when the viewer may review", async () => {
    const view = renderWithProviders(<PhotographerProfilePage />, { trpc: handlers(() => ELIGIBLE) });

    expect(await screen.findByText("Leave a Review")).toBeTruthy();
    expect(view.callsTo("review.getMyReviewState")).toEqual([{ photographerId: "ph-1" }]);
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  });

  it("explains why instead of showing the form", async () => {
    renderWithProviders(<PhotographerProfilePage />, {
      trpc: handlers(() => ({ ...ELIGIBLE, blocker: "no_completed_booking", canReview: false })),
    });

    expect(await screen.findByText("Reviews open after you have completed a booking together.")).toBeTruthy();
    expect(screen.queryByText("Leave a Review")).toBeNull();
  });

  it("says so when eligibility fails to load, and Try again loads it", async () => {
    let attempts = 0;
    const view = renderWithProviders(<PhotographerProfilePage />, {
      trpc: handlers(() => {
        attempts += 1;
        if (attempts === 1) throw trpcError("INTERNAL_SERVER_ERROR", "database unavailable");
        return ELIGIBLE;
      }),
    });

    expect(await screen.findByText(ERROR_TEXT)).toBeTruthy();
    expect(screen.queryByText("Leave a Review")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Leave a Review")).toBeTruthy();
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
    expect(view.callsTo("review.getMyReviewState")).toHaveLength(2);
  });

  it("keeps the error and the button after a retry that fails again", async () => {
    let attempts = 0;
    renderWithProviders(<PhotographerProfilePage />, {
      trpc: handlers(() => {
        attempts += 1;
        throw trpcError("INTERNAL_SERVER_ERROR", "still down");
      }),
    });

    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => expect(attempts).toBe(2));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();
  });

  it("asks nothing and shows neither form nor error to a visitor who is not signed in", async () => {
    testSession.signOut();
    const view = renderWithProviders(<PhotographerProfilePage />, { trpc: handlers(() => ELIGIBLE) });

    expect(await screen.findByText("Ann Lee")).toBeTruthy();
    expect(view.callsTo("review.getMyReviewState")).toEqual([]);
    expect(screen.queryByText("Leave a Review")).toBeNull();
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  });
});
