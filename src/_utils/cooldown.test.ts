import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cooldownRemaining, startCooldown } from "./cooldown";

describe("cooldownRemaining", () => {
  it("rounds up to whole seconds and stops at zero", () => {
    expect(cooldownRemaining(30_000, 0)).toBe(30);
    expect(cooldownRemaining(30_000, 29_001)).toBe(1);
    expect(cooldownRemaining(30_000, 30_000)).toBe(0);
    expect(cooldownRemaining(30_000, 45_000)).toBe(0);
  });
});

describe("startCooldown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the full time at once, then each second down to zero", () => {
    const ticks: number[] = [];
    startCooldown(3, (remaining) => ticks.push(remaining));
    expect(ticks).toEqual([3]);

    vi.advanceTimersByTime(3_000);
    expect(ticks).toEqual([3, 2, 1, 0]);
  });

  it("stops its timer when it reaches zero", () => {
    const onTick = vi.fn();
    startCooldown(1, onTick);
    vi.advanceTimersByTime(1_000);
    expect(onTick).toHaveBeenLastCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);

    onTick.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(onTick).not.toHaveBeenCalled();
  });

  it("can be stopped early, and says nothing afterwards", () => {
    const onTick = vi.fn();
    const stop = startCooldown(30, onTick);
    vi.advanceTimersByTime(1_000);
    stop();
    onTick.mockClear();

    vi.advanceTimersByTime(60_000);
    expect(onTick).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows the right number after the tab was asleep, because it reads the clock", () => {
    const ticks: number[] = [];
    startCooldown(30, (remaining) => ticks.push(remaining));

    // Timers did not run for 20 seconds; then one tick fires.
    vi.setSystemTime(Date.now() + 20_000);
    vi.advanceTimersByTime(250);
    expect(ticks.at(-1)).toBe(10);

    vi.setSystemTime(Date.now() + 60_000);
    vi.advanceTimersByTime(250);
    expect(ticks.at(-1)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restarting gives the full time again", () => {
    const ticks: number[] = [];
    const stop = startCooldown(30, (remaining) => ticks.push(remaining));
    vi.advanceTimersByTime(25_000);
    expect(ticks.at(-1)).toBe(5);

    // What the hook does when "Resend" is used again.
    stop();
    startCooldown(30, (remaining) => ticks.push(remaining));
    expect(ticks.at(-1)).toBe(30);
    vi.advanceTimersByTime(1_000);
    expect(ticks.at(-1)).toBe(29);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("is over at once for a zero-length cooldown", () => {
    const onTick = vi.fn();
    startCooldown(0, onTick);
    expect(onTick).toHaveBeenCalledExactlyOnceWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
