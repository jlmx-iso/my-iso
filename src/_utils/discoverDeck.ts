/**
 * When to ask the server for more Discover cards.
 *
 * The deck is "exhausted" when every card of the loaded batch has been
 * swiped. The next batch is then requested ONCE for that batch: if the
 * request fails, the deck stays exhausted but nothing is retried until the
 * member presses "Try again", so a server that is down is not hammered by an
 * effect that keeps firing.
 */
export type DeckRefillState = {
  /** `loadedAt` of the batch a refill was last requested for. */
  requestedFor: number | null;
  /** Refills in a row that did not put a card on screen. */
  inARow: number;
};

export const INITIAL_DECK_REFILL: DeckRefillState = { inARow: 0, requestedFor: null };

/**
 * A batch can come back holding only cards swiped a moment ago (the swipe
 * was still being saved). That is asked for again, but not without end.
 */
export const MAX_REFILLS_IN_A_ROW = 3;

export function nextDeckRefill(
  previous: DeckRefillState,
  deck: {
    /** Every card of the loaded batch has been swiped. */
    isExhausted: boolean;
    isFetching: boolean;
    /** When the loaded batch arrived; changes only when a request succeeds. */
    loadedAt: number;
  },
): { refill: boolean; state: DeckRefillState } {
  // Cards on screen (or no deck at all): nothing to do, and the count starts over.
  if (!deck.isExhausted) {
    return { refill: false, state: previous.inARow === 0 && previous.requestedFor === null ? previous : INITIAL_DECK_REFILL };
  }
  if (deck.isFetching) return { refill: false, state: previous };
  // Already asked for this batch: the request failed (or brought nothing new).
  if (previous.requestedFor === deck.loadedAt) return { refill: false, state: previous };
  if (previous.inARow >= MAX_REFILLS_IN_A_ROW) return { refill: false, state: previous };
  return { refill: true, state: { inARow: previous.inARow + 1, requestedFor: deck.loadedAt } };
}
