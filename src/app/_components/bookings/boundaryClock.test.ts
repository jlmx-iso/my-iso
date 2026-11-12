import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bookingCardActions } from "./bookingActions";
import { MAX_TIMEOUT_MS, nextBoundaryDelay, startBoundaryClock } from "./boundaryClock";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const T0 = new Date("2026-06-01T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("nextBoundaryDelay", () => {
  it("is the time to the nearest boundary still ahead, or null", () => {
    const at = (ms: number) => new Date(T0.getTime() + ms);

    expect(nextBoundaryDelay([at(5000), at(2000), at(-1000)], T0.getTime())).toBe(2000);
    expect(nextBoundaryDelay([at(0), at(-1)], T0.getTime())).toBeNull();
    expect(nextBoundaryDelay([], T0.getTime())).toBeNull();
    expect(nextBoundaryDelay([new Date(Number.NaN)], T0.getTime())).toBeNull();
  });
});

describe("a mounted booking card crossing the event's start and end", () => {
  // The event starts in two hours and lasts four.
  const event = { date: new Date(T0.getTime() + 2 * HOUR_MS), duration: 4 };
  const boundaries = [event.date, new Date(event.date.getTime() + event.duration * HOUR_MS)];

  /** What the card shows: its clock is the last time the boundary clock reported. */
  function mountCard(status: string, variant: "sent" | "received") {
    let now = new Date();
    const ticks: Date[] = [];
    const unmount = startBoundaryClock(boundaries, (at) => {
      now = at;
      ticks.push(at);
    });
    return {
      actions: () => bookingCardActions({ event, now, status, variant }),
      ticks,
      unmount,
    };
  }

  it("the owner's Accept disappears when the event starts, without a remount", () => {
    const card = mountCard("applied", "received");
    expect(card.actions()).toMatchObject({ accept: true, decline: true });

    vi.advanceTimersByTime(2 * HOUR_MS - 1);
    expect(card.actions().accept).toBe(true);
    expect(card.ticks).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(card.actions()).toMatchObject({ accept: false, decline: true });
    expect(card.ticks).toEqual([event.date]);
    card.unmount();
  });

  it("the applicant's Cancel disappears at the start and Mark Completed appears at the end", () => {
    const card = mountCard("accepted", "sent");
    expect(card.actions()).toMatchObject({ cancel: true, complete: false });

    // Across the start: no longer cancellable, not yet completable.
    vi.advanceTimersByTime(2 * HOUR_MS);
    expect(card.actions()).toMatchObject({ cancel: false, complete: false });

    // Still nothing new a moment before the end...
    vi.advanceTimersByTime(4 * HOUR_MS - 1);
    expect(card.actions().complete).toBe(false);
    // ...and across it, the booking can be completed.
    vi.advanceTimersByTime(1);
    expect(card.actions()).toMatchObject({ cancel: false, complete: true });

    // One timeout per boundary: the clock moved exactly twice, and nothing is left pending.
    expect(card.ticks).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    card.unmount();
  });

  it("arms a single timeout at a time, never an interval, and clears it on unmount", () => {
    const card = mountCard("accepted", "sent");
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(2 * HOUR_MS);
    expect(vi.getTimerCount()).toBe(1);

    card.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * HOUR_MS);
    expect(card.ticks).toHaveLength(1);
  });

  it("arms nothing for an event that is over", () => {
    vi.setSystemTime(new Date(T0.getTime() + 7 * HOUR_MS));
    const card = mountCard("accepted", "sent");

    expect(card.actions().complete).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    card.unmount();
  });

  it("reaches a boundary further away than one timeout can wait, and reports it only once it has passed", () => {
    const far = new Date(T0.getTime() + 40 * DAY_MS);
    const ticks: Date[] = [];
    const stop = startBoundaryClock([far], (at) => ticks.push(at));

    vi.advanceTimersByTime(MAX_TIMEOUT_MS);
    expect(ticks).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(40 * DAY_MS - MAX_TIMEOUT_MS);
    expect(ticks).toEqual([far]);
    stop();
  });
});
