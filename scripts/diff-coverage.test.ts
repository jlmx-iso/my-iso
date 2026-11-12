import { describe, expect, it } from "vitest";

import {
  computeDiffCoverage,
  formatRanges,
  formatReport,
  isMeasuredSource,
  parseDiff,
  parseLcov,
} from "./diff-coverage.mjs";

const DIFF = `diff --git a/src/server/a.ts b/src/server/a.ts
index 1111111..2222222 100644
--- a/src/server/a.ts
+++ b/src/server/a.ts
@@ -3,0 +4,2 @@ export function a() {
+  const x = 1;
+  return x;
@@ -10 +12 @@ function b() {
-  old();
+  replaced();
@@ -20,2 +22,0 @@ function c() {
-  gone();
-  gone();
diff --git a/src/server/new.ts b/src/server/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/server/new.ts
@@ -0,0 +1,3 @@
+export function n() {
+  return 1;
+}
diff --git a/src/server/removed.ts b/src/server/removed.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/server/removed.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const r = 1;
-export const s = 2;
diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 90%
rename from src/old-name.ts
rename to src/new-name.ts
index 5555555..6666666 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -7 +7 @@
-before
+after
`;

describe("parseDiff", () => {
  it("collects the new-side line numbers of added and edited lines", () => {
    const changed = parseDiff(DIFF);
    expect([...(changed.get("src/server/a.ts") ?? [])]).toEqual([4, 5, 12]);
    expect([...(changed.get("src/server/new.ts") ?? [])]).toEqual([1, 2, 3]);
  });

  it("skips deleted files and files with only removals", () => {
    const changed = parseDiff(DIFF);
    expect(changed.has("src/server/removed.ts")).toBe(false);
    const onlyRemoval = parseDiff(
      "diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -4,2 +3,0 @@\n-a\n-b\n",
    );
    expect(onlyRemoval.size).toBe(0);
  });

  it("uses the new path of a renamed file", () => {
    const changed = parseDiff(DIFF);
    expect(changed.has("src/old-name.ts")).toBe(false);
    expect([...(changed.get("src/new-name.ts") ?? [])]).toEqual([7]);
  });

  it("does not mistake changed lines starting with ++ or -- for file headers", () => {
    // The added line is "++ x" and the removed one "-- y": git prefixes
    // them with "+" and "-", so they read like headers.
    const changed = parseDiff(
      "diff --git a/src/y.ts b/src/y.ts\n--- a/src/y.ts\n+++ b/src/y.ts\n@@ -1 +2,2 @@\n--- y\n+++ x\n+z\n",
    );
    expect([...changed.keys()]).toEqual(["src/y.ts"]);
    expect([...(changed.get("src/y.ts") ?? [])]).toEqual([2, 3]);
  });

  it("returns nothing for an empty diff", () => {
    expect(parseDiff("").size).toBe(0);
  });
});

describe("parseLcov", () => {
  const root = "/repo";
  const lcov = [
    "TN:",
    "SF:/repo/src/server/a.ts",
    "FN:1,a",
    "DA:4,3",
    "DA:5,0",
    "DA:5,2",
    "DA:12,0",
    "end_of_record",
    "SF:src/relative.ts",
    "DA:1,1",
    "end_of_record",
  ].join("\n");

  it("keys files by path relative to the root", () => {
    const files = parseLcov(lcov, root);
    expect([...files.keys()]).toEqual(["src/server/a.ts", "src/relative.ts"]);
  });

  it("keeps the highest hit count for a line listed twice", () => {
    const hits = parseLcov(lcov, root).get("src/server/a.ts");
    expect(hits?.get(4)).toBe(3);
    expect(hits?.get(5)).toBe(2);
    expect(hits?.get(12)).toBe(0);
  });
});

describe("isMeasuredSource", () => {
  it.each([
    ["src/server/a.ts", true],
    ["src/app/x/Thing.tsx", true],
    ["src/server/a.test.ts", false],
    ["src/app/x/Thing.dom.test.tsx", false],
    ["src/test/helpers/sqlite.ts", false],
    ["scripts/diff-coverage.mjs", false],
    ["prisma/seed.ts", false],
  ])("%s -> %s", (file, expected) => {
    expect(isMeasuredSource(file)).toBe(expected);
  });
});

describe("formatRanges", () => {
  it("collapses consecutive lines", () => {
    expect(formatRanges([9, 3, 4, 5, 11, 12])).toBe("3-5, 9, 11-12");
    expect(formatRanges([])).toBe("");
  });
});

describe("computeDiffCoverage", () => {
  const changed = new Map([
    ["src/server/a.ts", new Set([1, 4, 5, 12])],
    ["src/server/a.test.ts", new Set([1, 2])],
    ["src/server/excluded.ts", new Set([1])],
    ["src/types/only.ts", new Set([3])],
  ]);
  const coverage = new Map([
    // Line 1 is not executable (absent): it does not count.
    ["src/server/a.ts", new Map([[4, 1], [5, 0], [12, 0]])],
    ["src/server/a.test.ts", new Map([[1, 0]])],
    ["src/types/only.ts", new Map<number, number>()],
  ]);

  it("counts only executable changed lines in measured source files", () => {
    const result = computeDiffCoverage(changed, coverage);
    expect(result.total).toBe(3);
    expect(result.covered).toBe(1);
    expect(result.percent).toBeCloseTo(33.33, 1);
    expect(result.files).toEqual([{ covered: 1, file: "src/server/a.ts", total: 3, uncovered: [5, 12] }]);
  });

  it("lists changed files the coverage report does not know as unmeasured", () => {
    expect(computeDiffCoverage(changed, coverage).unmeasured).toEqual(["src/server/excluded.ts"]);
  });

  it("passes when no executable line changed", () => {
    const result = computeDiffCoverage(new Map([["src/types/only.ts", new Set([3])]]), coverage);
    expect(result).toMatchObject({ percent: 100, total: 0 });
  });
});

describe("formatReport", () => {
  it("names each uncovered range and the verdict", () => {
    const report = formatReport(
      {
        covered: 1,
        files: [{ covered: 1, file: "src/server/a.ts", total: 3, uncovered: [5, 6, 12] }],
        percent: 33.3,
        total: 3,
        unmeasured: ["src/server/excluded.ts"],
      },
      90,
    );
    expect(report).toContain("33.3% of 3 changed executable lines");
    expect(report).toContain("FAIL");
    expect(report).toContain("src/server/a.ts  uncovered: 5-6, 12");
    expect(report).toContain("src/server/excluded.ts");
  });
});
