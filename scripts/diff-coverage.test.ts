import { describe, expect, it } from "vitest";

import {
  computeDiffCoverage,
  formatRanges,
  formatReport,
  isMeasuredSource,
  parseDiff,
  parseLcov,
  parseThreshold,
  passes,
  unquoteGitPath,
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

  it("reads paths git quotes (non-ASCII bytes, quotes, backslashes, control characters)", () => {
    const changed = parseDiff(
      [
        'diff --git "a/src/caf\\303\\251.ts" "b/src/caf\\303\\251.ts"',
        '--- "a/src/caf\\303\\251.ts"',
        '+++ "b/src/caf\\303\\251.ts"',
        "@@ -1 +1 @@",
        "-old",
        "+new",
        'diff --git "a/src/odd\\"name\\\\x\\t.ts" "b/src/odd\\"name\\\\x\\t.ts"',
        '--- "a/src/odd\\"name\\\\x\\t.ts"',
        '+++ "b/src/odd\\"name\\\\x\\t.ts"',
        "@@ -0,0 +4 @@",
        "+added",
      ].join("\n"),
    );
    expect([...changed.keys()]).toEqual(["src/café.ts", 'src/odd"name\\x\t.ts']);
    expect([...(changed.get("src/café.ts") ?? [])]).toEqual([1]);
  });

  it("leaves unquoted paths alone", () => {
    expect(unquoteGitPath("b/src/plain.ts")).toBe("b/src/plain.ts");
    expect(unquoteGitPath('"b/src/\\346\\227\\245.ts"')).toBe("b/src/日.ts");
  });

  it("keeps literal astral characters whole (core.quotePath=false leaves them unescaped)", () => {
    expect(unquoteGitPath('"b/src/😀\\"x.ts"')).toBe('b/src/😀"x.ts');
    // Octal escapes (raw UTF-8 bytes) mixed with literal astral characters.
    expect(unquoteGitPath('"b/src/caf\\303\\251-😀-\\360\\237\\230\\200-𝄞\\t.ts"')).toBe("b/src/café-😀-😀-𝄞\t.ts");
    expect(unquoteGitPath("b/src/😀.ts")).toBe("b/src/😀.ts");
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

  // As coverage.config.mjs would say for these paths.
  const status = (file: string) =>
    file === "src/server/excluded.ts" || file.startsWith("src/types/") ? ("excluded" as const) : ("measured" as const);

  it("counts only executable changed lines in measured source files", () => {
    const result = computeDiffCoverage(changed, coverage, status);
    expect(result.total).toBe(3);
    expect(result.covered).toBe(1);
    expect(result.percent).toBeCloseTo(33.33, 1);
    expect(result.files).toEqual([{ covered: 1, file: "src/server/a.ts", total: 3, uncovered: [5, 12] }]);
    expect(result.failures).toEqual([]);
  });

  it("lists changed files that coverage excludes, as a warning, not a failure", () => {
    const result = computeDiffCoverage(changed, coverage, status);
    expect(result.excluded).toEqual(["src/server/excluded.ts", "src/types/only.ts"]);
    expect(passes({ ...result, percent: 100 }, 90)).toBe(true);
  });

  it("lists changed files under src/ that coverage does not include, as a warning, not a failure", () => {
    const result = computeDiffCoverage(new Map([["src/styles/x.css", new Set([1])]]), coverage, () => "outside");
    expect(result).toMatchObject({ excluded: [], failures: [], missing: [], outside: ["src/styles/x.css"], total: 0 });
    expect(passes(result, 90)).toBe(true);
    expect(formatReport(result, 90)).toMatch(/WARNING: changed under src\/ but not matched[\s\S]*src\/styles\/x\.css/);
  });

  it("passes when no executable line changed", () => {
    const result = computeDiffCoverage(new Map([["src/types/only.ts", new Set([3])]]), coverage, status);
    expect(result).toMatchObject({ failures: [], percent: 100, total: 0 });
    expect(passes(result, 90)).toBe(true);
  });

  it("fails a changed file that should be measured but has no coverage record", () => {
    const result = computeDiffCoverage(new Map([["src/server/new.mjs", new Set([1, 2])]]), coverage, status);
    expect(result.missing).toEqual(["src/server/new.mjs"]);
    expect(result.failures).toHaveLength(1);
    expect(passes(result, 0)).toBe(false);
  });

  it("fails a coverage report that has no file under src/", () => {
    const foreign = new Map([["lib/other.ts", new Map([[1, 1]])]]);
    const result = computeDiffCoverage(new Map(), foreign, status);
    expect(result.failures[0]).toMatch(/no files under src\//);
    expect(passes(result, 0)).toBe(false);
  });
});

describe("parseThreshold", () => {
  it.each([
    ["90", 90],
    ["0", 0],
    ["100", 100],
    ["87.5", 87.5],
  ])("accepts %s", (value, expected) => {
    expect(parseThreshold(value)).toBe(expected);
  });

  it.each([["ninety"], [""], [" "], ["NaN"], ["Infinity"], ["-1"], ["101"], [undefined]])(
    "refuses %s",
    (value) => {
      expect(() => parseThreshold(value)).toThrow(/--threshold must be a number from 0 to 100/);
    },
  );
});

describe("formatReport", () => {
  const base = { excluded: [], failures: [], missing: [], outside: [] };

  it("names each uncovered range and the verdict, and warns about excluded files", () => {
    const report = formatReport(
      {
        ...base,
        covered: 1,
        excluded: ["src/app/x/page.tsx"],
        files: [{ covered: 1, file: "src/server/a.ts", total: 3, uncovered: [5, 6, 12] }],
        percent: 33.3,
        total: 3,
      },
      90,
    );
    expect(report).toContain("33.3% of 3 changed executable lines");
    expect(report).toContain("FAIL");
    expect(report).toContain("src/server/a.ts  uncovered: 5-6, 12");
    expect(report).toMatch(/WARNING: changed but excluded from coverage[\s\S]*src\/app\/x\/page\.tsx/);
  });

  it("puts failures first, with the files that have no record", () => {
    const report = formatReport(
      { ...base, covered: 0, failures: ["1 changed file(s) ..."], files: [], missing: ["src/a.mjs"], percent: 100, total: 0 },
      90,
    );
    expect(report.split("\n")[0]).toBe("FAIL: 1 changed file(s) ...");
    expect(report).toContain("no coverage record: src/a.mjs");
  });
});
