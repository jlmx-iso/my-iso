import { describe, expect, it } from "vitest";

import { aggregate, ratchet } from "./coverage-ratchet.mjs";

const entry = (covered: number, total: number) => ({
  branches: { covered, total },
  functions: { covered, total },
  lines: { covered, total },
  statements: { covered, total },
});

const summary = {
  "/repo/src/server/_db/a.ts": entry(9, 10),
  "/repo/src/server/_db/b.ts": entry(10, 10),
  "/repo/src/app/c.tsx": entry(0, 10),
  total: entry(19, 30),
};

describe("aggregate", () => {
  it("sums the files a glob matches", () => {
    expect(aggregate(summary, "/repo", "src/server/_db/**").lines).toBe(95);
    expect(aggregate(summary, "/repo", null).lines).toBeCloseTo(63.33, 1);
  });

  it("treats a glob with nothing to measure as fully covered", () => {
    expect(aggregate(summary, "/repo", "src/nothing/**").branches).toBe(100);
  });
});

describe("ratchet", () => {
  it("raises thresholds to the measured value rounded down", () => {
    const thresholds = {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
      "src/server/_db/**": { branches: 90, functions: 90, lines: 90, statements: 90 },
    };
    const { changes, next } = ratchet(thresholds, summary, "/repo");
    expect(next).toEqual({
      branches: 63,
      functions: 63,
      lines: 63,
      statements: 63,
      "src/server/_db/**": { branches: 95, functions: 95, lines: 95, statements: 95 },
    });
    expect(changes).toContainEqual({ from: 90, label: "src/server/_db/**", metric: "lines", to: 95 });
    // The input is not mutated.
    expect(thresholds.lines).toBe(50);
  });

  it("never lowers a threshold", () => {
    const thresholds = { lines: 80, "src/server/_db/**": { lines: 99 } };
    const { changes, next } = ratchet(thresholds, summary, "/repo");
    expect(next).toEqual(thresholds);
    expect(changes).toEqual([]);
  });

  it("leaves metrics a key does not set alone", () => {
    const { next } = ratchet({ "src/server/_db/**": { lines: 10 } }, summary, "/repo");
    expect(next).toEqual({ "src/server/_db/**": { lines: 95 } });
  });
});
