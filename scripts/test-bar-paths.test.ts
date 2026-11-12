import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluate,
  isMeasurementPackage,
  isProtectedPath,
  isRegistryRange,
  lockfileChangeIsSafe,
  packageJsonOnlyDependencies,
  PROTECTED_PATHS,
  protectedChanges,
  thresholdsOnlyRaised,
} from "./test-bar-paths.mjs";

const root = path.resolve(import.meta.dirname, "..");

describe("isProtectedPath", () => {
  it.each([
    "coverage-thresholds.json",
    "coverage.config.mjs",
    "vitest.config.ts",
    "package.json",
    "package-lock.json",
    ".npmrc",
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
    "apps/x/package-lock.json",
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

describe("packageJsonOnlyDependencies", () => {
  const basePackage = {
    dependencies: { next: "^16.4.6", react: "^19.3.1" },
    devDependencies: { prettier: "^3.10.0", vitest: "^5.1.0" },
    engines: { node: ">=22" },
    name: "my-iso",
    packageManager: "npm@10.9.9",
    overrides: { "@react-email/render": "$@react-email/render", glob: "^11.0.0" },
    scripts: { test: "vitest run", "test:coverage": "vitest run --coverage" },
    type: "module",
  };
  const base = JSON.stringify(basePackage, null, 2);
  const withChange = (change: Record<string, unknown>) => JSON.stringify({ ...basePackage, ...change });

  it("allows version bumps, added and removed dependencies, engines and overrides", () => {
    expect(packageJsonOnlyDependencies(base, base)).toBe(true);
    expect(
      packageJsonOnlyDependencies(
        base,
        withChange({
          dependencies: { next: "^16.5.0", "new-lib": "~2.1", react: "19.3.2" },
          devDependencies: { prettier: ">=3.10.1 <4", vitest: "^5.1.0", "@types/node": "^26.1.0" },
          engines: { node: ">=26", npm: ">=11" },
          packageManager: "npm@11.20.0",
          overrides: { "@react-email/render": "$@react-email/render", glob: "^13.0.0", "some-dep": { ".": "1.2.3-beta.4", inner: "^1 || ^2" } },
        }),
      ),
    ).toBe(true);
    // Formatting alone is not a change.
    expect(packageJsonOnlyDependencies(base, JSON.stringify(basePackage))).toBe(true);
  });

  it.each([
    ["a changed script", { scripts: { test: "vitest run --passWithNoTests", "test:coverage": "vitest run --coverage" } }],
    ["a removed script", { scripts: { test: "vitest run" } }],
    ["a new script", { scripts: { ...basePackage.scripts, pretest: "node x.js" } }],
    ["a new top-level field (imports can redirect modules)", { imports: { "#vitest": "./fake.js" } }],
    ["a changed type", { type: "commonjs" }],
    ["a changed name", { name: "other" }],
    ["a removed dependency field", { devDependencies: undefined }],
  ])("refuses %s", (_label, change) => {
    expect(packageJsonOnlyDependencies(base, withChange(change))).toBe(false);
  });

  it.each([
    ["an npm alias", "npm:not-vitest@1.0.0"],
    ["a git URL", "git+https://example.com/vitest.git"],
    ["a GitHub shorthand", "someone/vitest"],
    ["a local path", "file:../vitest"],
    ["a tarball URL", "https://example.com/vitest.tgz"],
    ["a dist-tag", "latest"],
    ["a dist-tag that starts with a digit", "5next"],
    ["a number with a leading zero", "01.2.3"],
    ["an empty range", ""],
  ])("refuses %s as a version", (_label, range) => {
    expect(packageJsonOnlyDependencies(base, withChange({ devDependencies: { prettier: range, vitest: "^5.1.0" } }))).toBe(false);
    expect(packageJsonOnlyDependencies(base, withChange({ overrides: { prettier: range } }))).toBe(false);
    expect(packageJsonOnlyDependencies(base, withChange({ overrides: { prettier: { ".": range } } }))).toBe(false);
  });

  describe("measurement tools always need the label", () => {
    it.each([
      ["a downgrade", { devDependencies: { prettier: "^3.10.0", vitest: "^4.0.0" } }],
      ["an upgrade", { devDependencies: { prettier: "^3.10.0", vitest: "^5.2.0" } }],
      ["a removal", { devDependencies: { prettier: "^3.10.0" } }],
      ["an added coverage provider", { devDependencies: { "@vitest/coverage-istanbul": "^5.1.0", prettier: "^3.10.0", vitest: "^5.1.0" } }],
      ["one moved to dependencies", { dependencies: { ...basePackage.dependencies, "happy-dom": "^21.0.4" } }],
      ["an override of a transitive coverage library", { overrides: { ...basePackage.overrides, "v8-to-istanbul": "9.0.0" } }],
      ["a nested override", { overrides: { ...basePackage.overrides, "@vitest/coverage-v8": { "ast-v8-to-istanbul": "0.1.0" } } }],
      ["a versioned override key", { overrides: { ...basePackage.overrides, "@playwright/test@1": "1.40.0" } }],
    ])("%s", (_label, change) => {
      expect(packageJsonOnlyDependencies(base, withChange(change))).toBe(false);
    });
  });

  it("refuses a $reference outside overrides, a non-string version and unknown engines", () => {
    expect(packageJsonOnlyDependencies(base, withChange({ dependencies: { next: "$next" } }))).toBe(false);
    expect(packageJsonOnlyDependencies(base, withChange({ dependencies: { next: 16 } }))).toBe(false);
    expect(packageJsonOnlyDependencies(base, withChange({ dependencies: ["next"] }))).toBe(false);
    expect(packageJsonOnlyDependencies(base, withChange({ engines: { node: ">=26", vscode: "^1" } }))).toBe(false);
    expect(packageJsonOnlyDependencies(base, withChange({ engines: ">=26" }))).toBe(false);
    expect(packageJsonOnlyDependencies(base, withChange({ packageManager: "yarn@4.1.0" }))).toBe(false);
    expect(packageJsonOnlyDependencies(base, withChange({ packageManager: "npm@11.20.0+sha512.abc" }))).toBe(false);
    expect(packageJsonOnlyDependencies(base, withChange({ packageManager: undefined }))).toBe(false);
  });

  it("refuses anything that is not a JSON object on either side", () => {
    expect(packageJsonOnlyDependencies(base, "not json")).toBe(false);
    expect(packageJsonOnlyDependencies("[]", base)).toBe(false);
    expect(packageJsonOnlyDependencies(base, "null")).toBe(false);
  });
});

describe("evaluate with package.json", () => {
  it("lets a dependency-only package.json change through without the label", () => {
    const result = evaluate({
      changed: ["package.json", "package-lock.json"],
      exception: false,
      lockfileSafe: true,
      packageDependenciesOnly: true,
      thresholdsRaisedOnly: false,
    });
    expect(result.pass).toBe(true);
    expect(result.summary).toContain("dependency versions only");
  });

  it("still needs the label for package.json when the change is not dependency-only, or with other test-bar files", () => {
    expect(evaluate({ changed: ["package.json"], exception: false, thresholdsRaisedOnly: false }).pass).toBe(false);
    expect(
      evaluate({ changed: ["package.json", "vitest.config.ts"], exception: false, packageDependenciesOnly: true, thresholdsRaisedOnly: false }),
    ).toMatchObject({ pass: false });
  });
});

describe("the command line", () => {
  const script = path.join(root, "scripts/test-bar-paths.mjs");
  const dir = mkdtempSync(path.join(tmpdir(), "test-bar-"));
  const write = (name: string, text: string) => {
    const file = path.join(dir, name);
    writeFileSync(file, text);
    return file;
  };
  const run = (args: string[]) =>
    spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "", HAS_EXCEPTION: "false" } });
  const files = write("changed.txt", "package.json\n");
  const pkgBase = write("base.json", JSON.stringify({ devDependencies: { prettier: "^3.10.0" }, scripts: { test: "vitest run" } }));

  it("passes a dependency bump given both package.json texts", () => {
    const head = write("head-deps.json", JSON.stringify({ devDependencies: { prettier: "^3.10.1" }, scripts: { test: "vitest run" } }));
    const result = run(["--files", files, "--package-base", pkgBase, "--package-head", head]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("fails a scripts change, and a package.json change it could not read", () => {
    const head = write("head-scripts.json", JSON.stringify({ devDependencies: { prettier: "^3.10.0" }, scripts: { test: "true" } }));
    expect(run(["--files", files, "--package-base", pkgBase, "--package-head", head]).status).toBe(1);
    expect(run(["--files", files]).status).toBe(1);
  });

  it("checks package-lock.json given both texts, and needs the label without them", () => {
    const lockFiles = write("changed-lock.txt", "package-lock.json\n");
    const lock = (resolved: string) =>
      JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/x": { resolved, version: "1.0.0" } } });
    const lockBase = write("lock-base.json", lock("https://registry.npmjs.org/x/-/x-0.9.0.tgz"));
    const good = write("lock-good.json", lock("https://registry.npmjs.org/x/-/x-1.0.0.tgz"));
    const bad = write("lock-bad.json", lock("https://example.com/x-1.0.0.tgz"));
    expect(run(["--files", lockFiles, "--lock-base", lockBase, "--lock-head", good]).status).toBe(0);
    expect(run(["--files", lockFiles, "--lock-base", lockBase, "--lock-head", bad]).status).toBe(1);
    expect(run(["--files", lockFiles]).status).toBe(1);
  });
});

describe("isRegistryRange", () => {
  it.each(["^1.2.3", "~4", ">=22", ">=22 <27", "5.0.0-beta.32", "1.2.3 || ^2", "1 - 2", "*", "1.x", "1.2.3+build.5"])(
    "%s is a range",
    (range) => {
      expect(isRegistryRange(range)).toBe(true);
    },
  );

  it.each(["5next", "latest", "next", "", "01.2.3", "1.2.3.4", "npm:vitest@5", "user/repo", "file:../x", "^1.2.3 ||| 2"])(
    "%s is not",
    (range) => {
      expect(isRegistryRange(range)).toBe(false);
    },
  );
});

describe("isMeasurementPackage", () => {
  it("knows the test runner, coverage, mutation, browser and DOM tools, and nothing else", () => {
    for (const name of ["vitest", "@vitest/coverage-v8", "vite", "@stryker-mutator/core", "@playwright/test", "playwright-core", "happy-dom", "@testing-library/react", "istanbul-lib-coverage", "v8-to-istanbul", "ast-v8-to-istanbul", "@bcoe/v8-coverage", "test-exclude", "magicast"]) {
      expect(isMeasurementPackage(name), name).toBe(true);
    }
    for (const name of ["next", "vite-plugin-x", "react", "@vitejs/plugin-react", "testing-library"]) {
      expect(isMeasurementPackage(name), name).toBe(false);
    }
  });
});

describe("lockfileChangeIsSafe", () => {
  const tarball = (name: string, version: string) => `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`;
  const lock = (packages: Record<string, Record<string, unknown>>) =>
    JSON.stringify({ lockfileVersion: 3, name: "my-iso", packages: { "": { name: "my-iso" }, ...packages } });
  const entry = (name: string, version: string) => ({ resolved: tarball(name, version), version });
  const base = lock({
    "node_modules/next": entry("next", "16.4.6"),
    "node_modules/vitest": entry("vitest", "5.1.0"),
    "node_modules/@vitest/coverage-v8/node_modules/ast-v8-to-istanbul": entry("ast-v8-to-istanbul", "0.3.0"),
  });

  it("allows a plain bump from the registry, and the repository's own lockfile against itself", () => {
    expect(
      lockfileChangeIsSafe(
        base,
        lock({
          "node_modules/next": entry("next", "16.5.0"),
          "node_modules/left-pad": entry("left-pad", "1.3.0"),
          "node_modules/vitest": entry("vitest", "5.1.0"),
          "node_modules/@vitest/coverage-v8/node_modules/ast-v8-to-istanbul": entry("ast-v8-to-istanbul", "0.3.0"),
        }),
      ),
    ).toBe(true);
    const own = readFileSync(path.join(root, "package-lock.json"), "utf8");
    expect(lockfileChangeIsSafe(own, own)).toBe(true);
  });

  it.each([
    ["a tarball from another host", { resolved: "https://evil.example/next-16.5.0.tgz", version: "16.5.0" }],
    ["a git dependency", { resolved: "git+ssh://git@github.com/x/next.git#abc", version: "16.5.0" }],
    ["a local link", { link: true, resolved: "../next" }],
    ["no resolved URL", { version: "16.5.0" }],
  ])("refuses %s", (_label, next) => {
    expect(
      lockfileChangeIsSafe(
        base,
        lock({
          "node_modules/next": next,
          "node_modules/vitest": entry("vitest", "5.1.0"),
          "node_modules/@vitest/coverage-v8/node_modules/ast-v8-to-istanbul": entry("ast-v8-to-istanbul", "0.3.0"),
        }),
      ),
    ).toBe(false);
  });

  it("refuses any change to a measurement tool's resolved version, even a transitive one", () => {
    const withVitest = (vitest: string, ast = "0.3.0") =>
      lock({
        "node_modules/next": entry("next", "16.4.6"),
        "node_modules/vitest": entry("vitest", vitest),
        "node_modules/@vitest/coverage-v8/node_modules/ast-v8-to-istanbul": entry("ast-v8-to-istanbul", ast),
      });
    expect(lockfileChangeIsSafe(base, withVitest("5.2.0"))).toBe(false);
    expect(lockfileChangeIsSafe(base, withVitest("4.0.0"))).toBe(false);
    expect(lockfileChangeIsSafe(base, withVitest("5.1.0", "0.2.0"))).toBe(false);
    expect(
      lockfileChangeIsSafe(base, lock({ "node_modules/next": entry("next", "16.4.6"), "node_modules/vitest": entry("vitest", "5.1.0") })),
    ).toBe(false);
  });

  it("refuses anything that is not a lockfile", () => {
    expect(lockfileChangeIsSafe(base, "nope")).toBe(false);
    expect(lockfileChangeIsSafe("{}", base)).toBe(false);
    expect(lockfileChangeIsSafe(base, JSON.stringify({ packages: { "node_modules/x": "1.0.0" } }))).toBe(false);
  });

  it("lets evaluate drop package-lock.json only when it is safe", () => {
    expect(evaluate({ changed: ["package-lock.json"], exception: false, lockfileSafe: true, thresholdsRaisedOnly: false })).toMatchObject({ pass: true });
    expect(evaluate({ changed: ["package-lock.json"], exception: false, thresholdsRaisedOnly: false }).pass).toBe(false);
    expect(evaluate({ changed: [".npmrc"], exception: false, lockfileSafe: true, packageDependenciesOnly: true, thresholdsRaisedOnly: false }).pass).toBe(false);
  });
});
