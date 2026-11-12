import { describe, expect, it } from "vitest";

import { compareExcludes, compareThresholds, flattenThresholds } from "./coverage-guard.mjs";

const base = {
  branches: 57,
  lines: 62,
  "src/server/_db/**": { branches: 88, lines: 93 },
};

describe("flattenThresholds", () => {
  it("names global and per-directory numbers", () => {
    expect([...flattenThresholds(base)]).toEqual([
      ["global branches", 57],
      ["global lines", 62],
      ["src/server/_db/** branches", 88],
      ["src/server/_db/** lines", 93],
    ]);
  });
});

describe("compareThresholds", () => {
  it("accepts equal or higher numbers, and new entries", () => {
    expect(
      compareThresholds(base, {
        ...base,
        lines: 63,
        "src/_lib/**": { lines: 70 },
        "src/server/_db/**": { branches: 90, lines: 93 },
      }),
    ).toEqual([]);
  });

  it("reports a lowered global or directory number", () => {
    expect(compareThresholds(base, { ...base, lines: 61, "src/server/_db/**": { branches: 87.5, lines: 93 } })).toEqual([
      "threshold lowered: global lines 62 -> 61",
      "threshold lowered: src/server/_db/** branches 88 -> 87.5",
    ]);
  });

  it("reports a removed metric or a removed directory", () => {
    const { "src/server/_db/**": _removed, ...withoutDir } = base;
    expect(compareThresholds(base, withoutDir)).toEqual([
      "threshold removed: src/server/_db/** branches (was 88)",
      "threshold removed: src/server/_db/** lines (was 93)",
    ]);
    const { branches: _b, ...withoutBranches } = base;
    expect(compareThresholds(base, withoutBranches)).toEqual(["threshold removed: global branches (was 57)"]);
  });
});

describe("compareExcludes", () => {
  const rules = { globs: ["src/test/**", "src/server/db.ts"], routeGlob: "src/app/**/page.tsx" };

  it("accepts the same or fewer exclusions", () => {
    expect(compareExcludes(rules, rules)).toEqual([]);
    expect(compareExcludes(rules, { ...rules, globs: ["src/test/**"] })).toEqual([]);
  });

  it("reports an added glob and a changed route rule", () => {
    expect(
      compareExcludes(rules, { globs: [...rules.globs, "src/app/**"], routeGlob: "src/app/**/*.tsx" }),
    ).toEqual(["exclusion added: src/app/**", "route-file exclusion rule changed: src/app/**/page.tsx -> src/app/**/*.tsx"]);
  });
});
