import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  COVERAGE_EXCLUDE_GLOBS,
  COVERAGE_INCLUDE,
  coverageExclude,
  coverageStatus,
  isClientModule,
  serverRouteFiles,
} from "../coverage.config.mjs";
import vitestConfig from "../vitest.config";

const root = path.resolve(import.meta.dirname, "..");

describe("coverage.config.mjs", () => {
  it("is what Vitest measures with: include, exclude and thresholds come from it and the JSON alone", () => {
    const coverage = vitestConfig.test?.coverage as {
      exclude?: string[];
      include?: string[];
      thresholds?: unknown;
    };
    expect(coverage.include).toEqual(COVERAGE_INCLUDE);
    expect(coverage.exclude).toEqual(coverageExclude(root));
    expect(coverage.thresholds).toEqual(JSON.parse(readFileSync(path.join(root, "coverage-thresholds.json"), "utf8")));
    // Nothing else that narrows what is measured or how it is judged.
    expect(Object.keys(coverage).sort()).toEqual(["exclude", "include", "provider", "reporter", "thresholds"]);
  });

  it("recognises the use client directive, after comments too", () => {
    expect(isClientModule('"use client";\nexport {}')).toBe(true);
    expect(isClientModule("'use client'\n")).toBe(true);
    expect(isClientModule('// A page.\n/* more */\n\n"use client";')).toBe(true);
    expect(isClientModule('import x from "y";\n"use client";')).toBe(false);
    expect(isClientModule("export default async function Page() {}")).toBe(false);
  });

  it("excludes server route files only; client route files are measured", () => {
    const servers = serverRouteFiles(root);
    const exclude = coverageExclude(root);
    expect(servers.length).toBeGreaterThan(0);
    for (const file of servers) {
      expect(isClientModule(readFileSync(path.join(root, file), "utf8")), file).toBe(false);
      expect(coverageStatus(file, exclude)).toBe("excluded");
    }
    expect(servers).not.toContain("src/app/global-error.tsx");
    expect(coverageStatus("src/app/global-error.tsx", exclude)).toBe("measured");
  });

  it.each([
    ["src/server/a.ts", "measured"],
    ["src/server/a.mjs", "measured"],
    ["src/app/x/Thing.jsx", "measured"],
    ["src/lib/legacy.cjs", "measured"],
    ["src/server/a.test.ts", "excluded"],
    ["src/server/_lib/emails/welcome.tsx", "excluded"],
    ["src/server/db.ts", "excluded"],
    ["src/styles/globals.css", "outside"],
    ["scripts/x.mjs", "outside"],
  ] as const)("%s is %s", (file, expected) => {
    expect(coverageStatus(file, COVERAGE_EXCLUDE_GLOBS)).toBe(expected);
  });
});
