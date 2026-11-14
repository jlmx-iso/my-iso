#!/usr/bin/env node
// Deploys one environment, in the only safe order:
//
//   0. stop if the database predates the migration baseline (it needs
//      `npm run db:upgrade-legacy` once, never run from here),
//   1. build the Worker for that environment (and upload source maps),
//   2. apply pending D1 migrations,
//   3. deploy the code that needs them.
//
// Usage: node scripts/deploy.mjs <staging|production>
//        (npm run deploy:staging / npm run deploy:production)
//
// `NEXT_PUBLIC_*` values are inlined into the JavaScript by the build, so
// each environment is its own build. Its build-time values come from
// `.env.deploy.<environment>` (gitignored; docs/DEPLOYMENT.md), loaded here.
// The name is deliberately not one Next.js loads by itself: OpenNext copies
// the contents of every `.env*` file Next.js loads into the Worker bundle, and
// a deploy must not pick up one environment's values (or a developer's
// secrets) through them. The deploy stops if any of those files exists.
//
// Runtime configuration and secrets are not needed to build: they are read
// when the Worker runs (wrangler.toml `[vars]`, `wrangler secret put`), and
// validated then (src/env.js).
//
// Runs from a developer machine, or as the deploy command of Cloudflare
// Workers Builds (production: `npm run deploy:production`). GitHub Actions
// CI (.github/workflows/ci.yml) never deploys.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyDatabase,
  parseWranglerJson,
  PROBE_BASELINE_SQL,
  PROBE_TABLES_SQL,
  WRANGLER_ENV_ARGS,
} from "./lib/legacyDb.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = {
  production: { migrate: "db:migrate:production", wranglerEnv: "--env=" },
  staging: { migrate: "db:migrate:staging", wranglerEnv: "--env=staging" },
};

const name = process.argv[2] ?? "";
if (!Object.hasOwn(TARGETS, name)) {
  console.error("Usage: node scripts/deploy.mjs <staging|production>");
  process.exit(1);
}
const target = TARGETS[/** @type {keyof typeof TARGETS} */ (name)];

// Cloudflare Workers Builds (the repository connected to the Worker) sets
// WORKERS_CI=1 and provides the build-time values as Build variables, so no
// file is read there. Everywhere else they come from `.env.deploy.<name>`.
const onWorkersBuilds = process.env.WORKERS_CI === "1";
const envFile = path.join(repoRoot, `.env.deploy.${name}`);
const configSource = onWorkersBuilds ? "the Workers Builds build variables" : path.basename(envFile);
if (onWorkersBuilds) {
  console.warn(`Workers Builds: reading the build-time values for ${name} from its build variables.`);
} else if (!existsSync(envFile)) {
  console.error(
    `Missing ${path.basename(envFile)}: the build-time configuration for ${name}.\n` +
      "See docs/DEPLOYMENT.md, \"Build-time values\".",
  );
  process.exit(1);
} else {
  // Does not override variables already set in the shell.
  process.loadEnvFile(envFile);
}
// The template leaves the optional PostHog CLI host empty; an empty value
// is not "unset" to the CLI, which then refuses it as an invalid host.
if (!process.env.POSTHOG_CLI_HOST) delete process.env.POSTHOG_CLI_HOST;
process.env.NEXT_PUBLIC_APP_ENV = name;

// The build validates nothing itself (see below), so check what it inlines.
const REQUIRED_AT_BUILD = [
  "NEXT_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_GOOGLE_PLACES_API_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLIC_KEY",
];
const missing = REQUIRED_AT_BUILD.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`${configSource} is missing: ${missing.join(", ")}`);
  process.exit(1);
}
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";
if (!baseUrl.startsWith("https://")) {
  console.error(`NEXT_PUBLIC_BASE_URL must be the https origin of ${name}; got "${baseUrl}".`);
  process.exit(1);
}
// OpenNext copies every env file Next.js loads into the Worker bundle as
// fallback values, for every mode (extract-project-env-vars.js in
// @opennextjs/cloudflare). A developer's keys would ship with the deploy, so
// refuse instead of warning. Local values belong in `.env.dev`.
const BUNDLED_ENV_FILES = [".env", ".env.local"].concat(
  ...["production", "development", "test"].map((mode) => [`.env.${mode}`, `.env.${mode}.local`]),
);
const bundled = BUNDLED_ENV_FILES.filter((file) => existsSync(path.join(repoRoot, file)));
if (bundled.length > 0) {
  console.error(
    `Deploy to ${name} stopped: ${bundled.join(", ")} would be copied into the Worker bundle. ` +
      "Move local values to .env.dev (docs/DEPLOYMENT.md, \"Local values\"). Nothing was changed.",
  );
  process.exit(1);
}
// Source maps are uploaded here and only here: for exactly the files this
// run deploys (scripts/sourcemaps.mjs).
if (process.env.POSTHOG_CLI_API_KEY && process.env.POSTHOG_CLI_PROJECT_ID) {
  process.env.SOURCEMAPS = "upload";
} else {
  delete process.env.SOURCEMAPS;
  console.warn("No POSTHOG_CLI_API_KEY / POSTHOG_CLI_PROJECT_ID: source maps are not uploaded.");
}
// Server-side variables are validated when the Worker starts, with the real
// secrets, not at build time where they are deliberately absent.
process.env.SKIP_ENV_VALIDATION = "1";

/**
 * @param {string} title
 * @param {string} command
 * @param {string[]} args
 */
function step(title, command, args) {
  console.warn(`\n==> ${title}`);
  const result = spawnSync(command, args, { cwd: repoRoot, env: process.env, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\nDeploy to ${name} stopped: "${title}" failed. Nothing after it was run.`);
    process.exit(result.status ?? 1);
  }
}

/**
 * Runs one read-only query on the remote database of this environment.
 *
 * @param {string} sql
 */
function queryRemote(sql) {
  const result = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", "--remote", "--json", "--command", sql, ...WRANGLER_ENV_ARGS[/** @type {keyof typeof WRANGLER_ENV_ARGS} */ (name)]],
    { cwd: repoRoot, encoding: "utf8", env: process.env, stdio: ["inherit", "pipe", "inherit"] },
  );
  if (result.status !== 0) {
    console.error(`\nDeploy to ${name} stopped: could not read the database's migration state. Nothing was changed.`);
    process.exit(result.status ?? 1);
  }
  return parseWranglerJson(result.stdout);
}

// A database created before the migration baseline has the app's tables but
// no record of 0001_init.sql; `migrations apply` would try to create them
// again and fail. It is upgraded once, deliberately, by a separate command:
// never here.
console.warn(`\n==> Check the ${name} database's migration state`);
const tables = queryRemote(PROBE_TABLES_SQL).map((row) => String(row.name));
const baselineApplied =
  tables.includes("d1_migrations") && Number(queryRemote(PROBE_BASELINE_SQL)[0]?.applied ?? 0) > 0;
if (classifyDatabase({ baselineApplied, tables }) === "pre-baseline") {
  console.error(
    `\nDeploy to ${name} stopped: its database was created before the migration baseline ` +
      "(it has the app's tables but 0001_init.sql is not recorded), so migrations cannot be applied to it yet. " +
      `Upgrade it once with:\n\n  npm run db:upgrade-legacy -- --env ${name}\n\n` +
      "then deploy again. See docs/DATABASE.md, \"Upgrading a database created before the baseline\". Nothing was changed.",
  );
  process.exit(1);
}

// Fails before anything is changed if the build or the bundle is broken.
step(`Build the Worker for ${name} (${baseUrl})`, "npm", ["run", "build:cf"]);
step("Check the bundle", "npm", ["run", "check:bundle"]);
// Migrations first: they are written so the code already deployed keeps
// working (docs/DATABASE.md), while the new code may not work without them.
step(`Apply D1 migrations to ${name}`, "npm", ["run", target.migrate]);
// The Worker entry (worker.ts) is bundled by wrangler, not Next.js, so the
// PostHog project token inlined into the app is handed to it as a variable.
const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PUBLIC_KEY;
step(`Deploy the Worker to ${name}`, "npx", [
  "wrangler",
  "deploy",
  target.wranglerEnv,
  ...(projectToken ? ["--var", `NEXT_PUBLIC_POSTHOG_PUBLIC_KEY:${projectToken}`] : []),
]);

console.warn(`\nDeployed ${name}. Check ${baseUrl}/api/health`);
