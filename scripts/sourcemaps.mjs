#!/usr/bin/env node
// Runs after every Worker build (`postbuild:cf`). Two jobs:
//
//   1. When PostHog CLI credentials are present, give each browser chunk a
//      chunk id ("inject") and upload its source map to PostHog, so error
//      tracking shows original file names and lines. The CLI then deletes
//      the maps and the `sourceMappingURL` comments.
//   2. Always: make sure no source map is left in the deployed assets.
//      Source maps contain the original source and must not be public.
//
// The injected files are what gets deployed, so this has to run on the same
// build output that `wrangler deploy` uploads: `npm run deploy:*` does both.
//
// Credentials (docs/DEPLOYMENT.md):
//   POSTHOG_CLI_API_KEY     personal API key with error-tracking write access
//   POSTHOG_CLI_PROJECT_ID  numeric project id
//   POSTHOG_CLI_HOST        optional; default https://us.posthog.com
//
// next.config.js only generates browser source maps when the first two are
// set, so without them there is nothing to upload and nothing to strip.
//
// Usage: node scripts/sourcemaps.mjs [--dry-run]
//   --dry-run  go through the CLI's selection without contacting PostHog

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = path.join(repoRoot, ".open-next", "assets");
const chunksDir = path.join(assetsDir, "_next", "static");
const RELEASE_NAME = "my-iso";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean" } } });

/**
 * @param {string} dir
 * @returns {string[]} every `.map` file under `dir`
 */
function findMaps(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".map"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** @param {string} message */
function fail(message) {
  console.error(`sourcemaps: ${message}`);
  process.exit(1);
}

function releaseVersion() {
  const fromCi = process.env.GITHUB_SHA ?? process.env.WORKERS_CI_COMMIT_SHA;
  if (fromCi) return fromCi.slice(0, 12);
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

if (!existsSync(assetsDir)) {
  fail(`${assetsDir} does not exist. Run \`npm run build:cf\` first.`);
}

const hasCredentials = Boolean(
  process.env.POSTHOG_CLI_API_KEY && process.env.POSTHOG_CLI_PROJECT_ID,
);
const maps = findMaps(chunksDir);

if (values["dry-run"] || hasCredentials) {
  if (maps.length === 0) {
    fail(
      "PostHog CLI credentials are set but the build produced no browser source maps. " +
        "They must be set when `next build` runs, not only now.",
    );
  }

  const args = [
    ...(values["dry-run"] ? ["--dry-run"] : []),
    "sourcemap",
    "process",
    "--directory",
    chunksDir,
    "--release-name",
    RELEASE_NAME,
    "--release-version",
    releaseVersion(),
    "--delete-after",
  ];
  console.warn(
    `sourcemaps: ${values["dry-run"] ? "dry run for" : "uploading"} ${maps.length} source maps (release ${RELEASE_NAME}@${releaseVersion()})`,
  );
  const cli = spawnSync(path.join(repoRoot, "node_modules", ".bin", "posthog-cli"), args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (cli.status !== 0) {
    // Do not deploy a build whose maps are still in the assets directory.
    for (const file of findMaps(assetsDir)) rmSync(file);
    fail(`posthog-cli exited with status ${cli.status}; source maps were removed, not uploaded.`);
  }
} else {
  console.warn(
    "sourcemaps: POSTHOG_CLI_API_KEY / POSTHOG_CLI_PROJECT_ID not set; skipping the upload.",
  );
}

// Whatever happened above, nothing ending in .map may be deployed.
const leftovers = findMaps(assetsDir);
for (const file of leftovers) rmSync(file);
if (leftovers.length > 0) {
  console.warn(`sourcemaps: removed ${leftovers.length} source maps from the deployed assets.`);
}
if (findMaps(assetsDir).length > 0) fail("source maps are still present in the assets directory.");
console.warn("sourcemaps: no source maps in the deployed assets.");
