import path from "node:path";

import { describe, expect, it } from "vitest";

import { compareMeasured, compareRules, compareThresholds, flattenThresholds } from "./coverage-guard.mjs";

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

describe("compareRules", () => {
  const rules = {
    COVERAGE_EXCLUDE_GLOBS: ["src/test/**", "src/server/db.ts"],
    COVERAGE_INCLUDE: ["src/**/*.{ts,tsx}"],
    ROUTE_CONVENTION_GLOB: "src/app/**/page.tsx",
  };

  it("accepts the same or fewer exclusions, and more include patterns", () => {
    expect(compareRules(rules, rules)).toEqual([]);
    expect(compareRules(rules, { ...rules, COVERAGE_EXCLUDE_GLOBS: ["src/test/**"] })).toEqual([]);
    expect(compareRules(rules, { ...rules, COVERAGE_INCLUDE: [...rules.COVERAGE_INCLUDE, "lib/**"] })).toEqual([]);
  });

  it("reports a removed include pattern, an added glob and a changed route rule", () => {
    expect(
      compareRules(rules, {
        COVERAGE_EXCLUDE_GLOBS: [...rules.COVERAGE_EXCLUDE_GLOBS, "src/app/**"],
        COVERAGE_INCLUDE: ["src/server/**/*.ts"],
        ROUTE_CONVENTION_GLOB: "src/app/**/*.tsx",
      }),
    ).toEqual([
      "include pattern removed: src/**/*.{ts,tsx}",
      "exclusion added: src/app/**",
      "route-file exclusion rule changed: src/app/**/page.tsx -> src/app/**/*.tsx",
    ]);
  });
});

describe("compareMeasured", () => {
  const files = ["src/a.ts", "src/app/page.tsx", "src/b.test.ts", "src/c.ts"];
  const base = (file: string) => (file.endsWith(".test.ts") ? "excluded" : "measured");

  it("reports each file the head rules stop measuring, however they do it", () => {
    // E.g. a changed isClientModule that excludes every route file again,
    // and an include narrowed to leave src/c.ts out.
    const head = (file: string) =>
      file === "src/app/page.tsx" ? "excluded" : file === "src/c.ts" ? "outside" : base(file);
    expect(compareMeasured(files, base, head)).toEqual([
      "no longer measured (excluded): src/app/page.tsx",
      "no longer measured (outside): src/c.ts",
    ]);
  });

  it("accepts measuring the same files or more", () => {
    expect(compareMeasured(files, base, base)).toEqual([]);
    expect(compareMeasured(files, base, () => "measured")).toEqual([]);
  });
});

describe("the real coverage.config.mjs", () => {
  it("measures exactly what it measured: loaded twice, nothing changes", async () => {
    const rules = await import("../coverage.config.mjs");
    const root = path.resolve(import.meta.dirname, "..");
    const exclude = rules.coverageExclude(root);
    const status = (file: string) => rules.coverageStatus(file, exclude);
    expect(compareRules(rules, rules)).toEqual([]);
    expect(compareMeasured(["src/server/api/trpc.ts", "src/app/global-error.tsx"], status, status)).toEqual([]);
    expect(status("src/server/api/trpc.ts")).toBe("measured");
  });
});
