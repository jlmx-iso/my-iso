import type { RouterOutputs } from "~/trpc/react";

type ReviewState = RouterOutputs["review"]["getMyReviewState"];
type OwnReview = NonNullable<ReviewState["myReview"]>;

export type ReviewGate =
  | { kind: "form" }
  | { kind: "own"; review: OwnReview }
  | { kind: "blocked"; message: string }
  | { kind: "none" };

/**
 * What a signed-in visitor sees under a photographer's reviews: the form
 * only when the server would accept a review, their own review if they
 * wrote one, otherwise one line saying why not.
 */
export function reviewGate(state: ReviewState, photographerName: string): ReviewGate {
  if (state.myReview) return { kind: "own", review: state.myReview };
  if (state.canReview) return { kind: "form" };
  switch (state.blocker) {
    case "no_completed_booking":
      return {
        kind: "blocked",
        message: `You can review ${photographerName} after you've completed a booking together.`,
      };
    case "already_reviewed":
      return { kind: "blocked", message: `You've already reviewed ${photographerName}.` };
    case "self":
      return { kind: "blocked", message: "You can't review your own profile." };
    default:
      return { kind: "none" };
  }
}

/** What a signed-in non-owner sees under the reviews, including while the server's answer is loading or failed. */
export type MemberReviewView = ReviewGate | { kind: "loading" } | { kind: "error" };

/**
 * Decides from the eligibility query: an answer (even a stale one while a
 * refetch fails) decides the gate; a failure with no answer is an error the
 * visitor can retry, never silence.
 */
export function memberReviewView(
  query: { data?: ReviewState; isError: boolean },
  photographerName: string,
): MemberReviewView {
  if (query.data) return reviewGate(query.data, photographerName);
  return query.isError ? { kind: "error" } : { kind: "loading" };
}
