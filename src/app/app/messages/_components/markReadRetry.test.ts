import { describe, expect, it } from "vitest";

import { isLatestMarkReadAttempt, MARK_READ_MAX_RETRIES, markReadRetryDelayMs } from "./markReadRetry";

describe("markReadRetryDelayMs", () => {
  it("backs off from five seconds to a minute, then gives up", () => {
    const delays = Array.from({ length: MARK_READ_MAX_RETRIES + 2 }, (_, index) => markReadRetryDelayMs(index + 1));

    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000, null, null]);
  });

  it("is bounded in total: a thread left open does not retry for ever", () => {
    let total = 0;
    for (let failures = 1; ; failures += 1) {
      const delay = markReadRetryDelayMs(failures);
      if (delay === null) break;
      total += delay;
    }
    expect(total).toBe(195_000);
  });
});

describe("isLatestMarkReadAttempt", () => {
  it("acts on a failure of the latest attempt only", () => {
    // Request A (message m1) is pending when m2 arrives and request B starts.
    const latest = "m2";

    // B fails first: it is the latest, so its retry is scheduled.
    expect(isLatestMarkReadAttempt(latest, "m2")).toBe(true);
    // A fails afterwards: it must not clear B's timer or reschedule for itself.
    expect(isLatestMarkReadAttempt(latest, "m1")).toBe(false);
  });

  it("ignores a failure when nothing has been attempted, or the call named no message", () => {
    expect(isLatestMarkReadAttempt(null, "m1")).toBe(false);
    expect(isLatestMarkReadAttempt("m1", undefined)).toBe(false);
  });
});
