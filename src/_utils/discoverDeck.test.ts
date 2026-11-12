import { describe, expect, it } from "vitest";

import { INITIAL_DECK_REFILL, MAX_REFILLS_IN_A_ROW, type DeckRefillState, nextDeckRefill } from "./discoverDeck";

type Deck = Parameters<typeof nextDeckRefill>[1];

/** Runs the effect's decision over a sequence of renders; returns how many refills were requested. */
function run(renders: Deck[], start: DeckRefillState = INITIAL_DECK_REFILL) {
  let state = start;
  let refills = 0;
  for (const deck of renders) {
    const step = nextDeckRefill(state, deck);
    state = step.state;
    if (step.refill) refills += 1;
  }
  return { refills, state };
}

const exhausted = (loadedAt: number, isFetching = false): Deck => ({ isExhausted: true, isFetching, loadedAt });
const withCards = (loadedAt: number): Deck => ({ isExhausted: false, isFetching: false, loadedAt });

describe("nextDeckRefill", () => {
  it("does nothing while there are cards", () => {
    expect(run([withCards(1), withCards(1)])).toEqual({ refills: 0, state: INITIAL_DECK_REFILL });
  });

  it("asks for the next batch once when the deck runs out", () => {
    expect(run([withCards(1), exhausted(1)]).refills).toBe(1);
  });

  it("does not ask again while that request is in flight", () => {
    expect(run([exhausted(1), exhausted(1, true), exhausted(1, true)]).refills).toBe(1);
  });

  it("does not loop when the refill fails", () => {
    // A failed request leaves the same batch loaded and fetching off again:
    // exactly the render the old effect refetched on, forever.
    const renders = [exhausted(1), exhausted(1, true), ...Array.from({ length: 50 }, () => exhausted(1))];
    expect(run(renders).refills).toBe(1);
  });

  it("asks again after a manual retry brought a new batch that also ran out", () => {
    const renders = [exhausted(1), exhausted(1, true), exhausted(1), withCards(2), exhausted(2)];
    expect(run(renders).refills).toBe(2);
  });

  it("starts counting afresh once cards are on screen", () => {
    const { state } = run([exhausted(1), exhausted(1, true), withCards(2)]);
    expect(state).toEqual(INITIAL_DECK_REFILL);
  });

  it("gives up when batch after batch holds only cards already swiped", () => {
    // Every refill succeeds (a new loadedAt) but the deck is still exhausted.
    const renders = Array.from({ length: 20 }, (_, index) => [exhausted(index + 1), exhausted(index + 1, true)]).flat();
    expect(run(renders).refills).toBe(MAX_REFILLS_IN_A_ROW);
  });

  it("keeps the same state object when nothing changes", () => {
    expect(nextDeckRefill(INITIAL_DECK_REFILL, withCards(1)).state).toBe(INITIAL_DECK_REFILL);
    const asked = { inARow: 1, requestedFor: 1 };
    expect(nextDeckRefill(asked, exhausted(1)).state).toBe(asked);
  });
});
