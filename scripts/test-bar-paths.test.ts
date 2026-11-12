import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { evaluate, isProtectedPath, PROTECTED_PATHS, protectedChanges, thresholdsOnlyRaised } from "./test-bar-paths.mjs";

const root = path.resolve(import.meta.dirname, "..");

describe("isProtectedPath", () => {
  it.each([
    "coverage-thresholds.json",
    "coverage.config.mjs",
    "vitest.config.ts",
    "package.json",
    "stryker.config.mjs",
    "scripts/coverage-guard.mjs",
    "scripts/coverage-ratchet.mjs",
    "scripts/diff-coverage.mjs",
    "scripts/test-bar-paths.mjs",
    "src/test/dom/strict.ts",
    "src/test/dom/setup.ts",
    "src/test/dom/render.tsx",
    "src/test/setup.ts",
    "src/test/helpers/dbCaller.ts",
    "src/server/api/authz.matrix.test.ts",
    "src/server/api/trpc.ts",
    ".github/workflows/ci.yml",
    ".github/workflows/test-bar-guard.yml",
    ".github/CODEOWNERS",
  ])("%s is part of the test bar", (file) => {
    expect(isProtectedPath(file)).toBe(true);
  });

  it.each([
    "src/server/api/routers/user.ts",
    "src/app/page.tsx",
    "src/test/dom/session.ts",
    "scripts/deploy.mjs",
    "docs/TESTING.md",
    "apps/x/package.json",
    "package-lock.json",
    ".github/ISSUE_TEMPLATE.md",
  ])("%s is not", (file) => {
    expect(isProtectedPath(file)).toBe(false);
  });

  it("matches every path CODEOWNERS lists (the two lists stay in step)", () => {
    const owned = readFileSync(path.join(root, ".github/CODEOWNERS"), "utf8")
      .split("\n")
      .filter((line) => line.startsWith("/"))
      .map((line) => line.split(/\s+/)[0]!.slice(1));
    for (const entry of owned) {
      const example = entry.endsWith("/") ? `${entry}x.yml` : entry;
      expect(isProtectedPath(example), entry).toBe(true);
    }
    // And the other way round: each protected pattern has an owner entry.
    for (const pattern of PROTECTED_PATHS) {
      const covered = owned.some((entry) =>
        entry.endsWith("/") ? pattern.startsWith(entry) : entry === pattern || path.matchesGlob(entry, pattern),
      );
      expect(covered, pattern).toBe(true);
    }
  });
});

describe("protectedChanges", () => {
  it("keeps the protected paths, sorted, once each, ignoring blank lines", () => {
    expect(
      protectedChanges(["src/app/x.tsx", "vitest.config.ts", "", ".github/workflows/ci.yml", "vitest.config.ts\r"]),
    ).toEqual([".github/workflows/ci.yml", "vitest.config.ts"]);
  });
});

describe("thresholdsOnlyRaised", () => {
  const base = JSON.stringify({ lines: 72, "src/_lib/**": { lines: 75 } });

  it("is true for equal or higher numbers", () => {
    expect(thresholdsOnlyRaised(base, base)).toBe(true);
    expect(thresholdsOnlyRaised(base, JSON.stringify({ lines: 73, "src/_lib/**": { lines: 80 } }))).toBe(true);
  });

  it("is false for a lowered or removed number, and for anything that is not a JSON object", () => {
    expect(thresholdsOnlyRaised(base, JSON.stringify({ lines: 71, "src/_lib/**": { lines: 75 } }))).toBe(false);
    expect(thresholdsOnlyRaised(base, JSON.stringify({ lines: 72 }))).toBe(false);
    expect(thresholdsOnlyRaised(base, "not json")).toBe(false);
    expect(thresholdsOnlyRaised(base, "[]")).toBe(false);
  });
});

describe("evaluate", () => {
  it("passes when no test-bar file changed", () => {
    expect(evaluate({ changed: ["src/app/x.tsx"], exception: false, thresholdsRaisedOnly: false })).toMatchObject({
      pass: true,
    });
  });

  it("fails without the label and says the label is required", () => {
    const result = evaluate({ changed: ["vitest.config.ts"], exception: false, thresholdsRaisedOnly: false });
    expect(result.pass).toBe(false);
    expect(result.summary).toContain("- `vitest.config.ts`");
    expect(result.summary).toContain("**Needs the `coverage-exception` label.**");
  });

  it("passes with the label, still listing the files", () => {
    const result = evaluate({ changed: ["package.json"], exception: true, thresholdsRaisedOnly: false });
    expect(result.pass).toBe(true);
    expect(result.summary).toContain("- `package.json`");
  });

  it("lets a ratchet (thresholds only raised) through without the label", () => {
    expect(
      evaluate({ changed: ["coverage-thresholds.json"], exception: false, thresholdsRaisedOnly: true }),
    ).toMatchObject({ pass: true });
    expect(
      evaluate({ changed: ["coverage-thresholds.json"], exception: false, thresholdsRaisedOnly: false }).pass,
    ).toBe(false);
  });
});
