// What coverage measures: the one definition read by vitest.config.ts, by
// scripts/diff-coverage.mjs (to tell an excluded file from a missing one)
// and by scripts/coverage-guard.mjs (which fails a pull request that adds
// an exclusion without the `coverage-exception` label). docs/TESTING.md.
//
// Self-contained on purpose (node: imports only): the guard imports the
// base branch's copy of this file to compare against it.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Every source file under src/ counts, including ones no test imports (0%). */
export const COVERAGE_INCLUDE = ["src/**/*.{ts,tsx,js,jsx,mjs,cjs}"];

/**
 * Left out of coverage, each with the reason. Add to this list only for code
 * that cannot run under Vitest; a pull request that adds an entry needs the
 * `coverage-exception` label.
 */
export const COVERAGE_EXCLUDE_GLOBS = [
  // Tests and their helpers are not product code.
  "src/**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}",
  "src/test/**",
  // Type-only: no runtime code to cover.
  "**/*.d.ts",
  "src/types/**",
  "src/_types/**",
  "src/styles/**",
  // Browser bootstrap that runs PostHog init as an import side effect.
  "src/instrumentation-client.ts",
  // Next.js edge middleware: three lines of NextAuth wiring; the config it
  // uses (auth.config.ts) is covered.
  "src/middleware.ts",
  // Picks the Prisma driver from the runtime at import time (D1 inside the
  // Worker, a SQLite file in dev). Tests inject their own SQLite client
  // (src/test/helpers/sqlite.ts) and never import it.
  "src/server/db.ts",
  // The Durable Object class imports `cloudflare:workers`, which only exists
  // in workerd. Its decisions live in chatRoomPolicy.ts and
  // realtimeGateway.ts, which are covered.
  "src/do/ChatRoom.ts",
  // React Email templates: static markup with props, type-checked and built.
  // The sending code (email.ts) stays in.
  "src/server/_lib/emails/**",
];

/**
 * Next.js route-convention files. Those that are SERVER components (no
 * "use client" directive) are left out: async server components and layouts
 * that need the Next.js request scope (headers(), cookies(), redirect(), the
 * RSC tRPC caller), exercised by the build and the workerd E2E smoke. A
 * route file that is a client component is measured like any component.
 * Route handlers (route.ts), sitemap and robots are plain functions and stay
 * in.
 */
export const ROUTE_CONVENTION_GLOB =
  "src/app/**/{page,layout,loading,error,not-found,template,default,global-error}.{ts,tsx,js,jsx}";

/** Leading comments and blank lines, then the "use client" directive. */
const USE_CLIENT = /^(?:\s+|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/;

/**
 * Whether a module's source starts with the "use client" directive.
 *
 * @param {string} source
 */
export function isClientModule(source) {
  return USE_CLIENT.test(source);
}

/** @param {string} dir @param {string} root @returns {string[]} */
function listFiles(dir, root) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full, root));
    else files.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return files;
}

/**
 * The route-convention files under `root` that are server components, as
 * repo-relative paths, sorted.
 *
 * @param {string} root
 */
export function serverRouteFiles(root) {
  return listFiles(path.join(root, "src", "app"), root)
    .filter((file) => path.matchesGlob(file, ROUTE_CONVENTION_GLOB))
    .filter((file) => !isClientModule(readFileSync(path.join(root, file), "utf8")))
    .sort();
}

/**
 * Vitest's `coverage.exclude`: the hand-kept globs plus the server route
 * files found now.
 *
 * @param {string} root
 */
export function coverageExclude(root) {
  return [...COVERAGE_EXCLUDE_GLOBS, ...serverRouteFiles(root)];
}

/**
 * How coverage treats a repo-relative path: "measured", "excluded" (by a
 * glob or as a server route file) or "outside" (not matched by include).
 *
 * @param {string} file
 * @param {readonly string[]} exclude  as returned by coverageExclude
 * @returns {"measured" | "excluded" | "outside"}
 */
export function coverageStatus(file, exclude) {
  if (!COVERAGE_INCLUDE.some((glob) => path.matchesGlob(file, glob))) return "outside";
  return exclude.some((glob) => glob === file || path.matchesGlob(file, glob)) ? "excluded" : "measured";
}
