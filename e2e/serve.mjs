#!/usr/bin/env node
// Starts the BUILT Worker (run `npm run build:cf` first) under `wrangler dev`
// for the end-to-end tests, with a fresh local D1 in e2e/.state: every file
// in migrations/, then prisma/seed-staging.sql. Playwright starts this as
// its web server (playwright.config.ts); it can also be run by hand.
//
// Runtime configuration comes from --var flags only, so a developer's
// .dev.vars is neither needed nor read. None of the values are real
// credentials and nothing here talks to Google, Stripe, Resend or PostHog.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import { E2E_AUTH_SECRET, E2E_PORT } from "./config.mjs";

const root = path.resolve(import.meta.dirname, "..");
const state = path.join(root, "e2e", ".state");
const origin = `http://localhost:${E2E_PORT}`;

if (!existsSync(path.join(root, ".open-next", "worker.js"))) {
  console.error("No .open-next/worker.js: run `npm run build:cf` first.");
  process.exit(2);
}

/** @param {string[]} args */
function wrangler(args) {
  const result = spawnSync("npx", ["wrangler", ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

rmSync(state, { force: true, recursive: true });
wrangler(["d1", "migrations", "apply", "DB", "--local", "--persist-to", state]);
wrangler(["d1", "execute", "DB", "--local", "--persist-to", state, "--file", "prisma/seed-staging.sql"]);

const vars = {
  APP_ENV: "development",
  AUTH_SECRET: E2E_AUTH_SECRET,
  AUTH_URL: origin,
  CLOUDINARY_API_KEY: "e2e-placeholder",
  CLOUDINARY_API_SECRET: "e2e-placeholder",
  CLOUDINARY_CLOUD_NAME: "e2e-placeholder",
  EMAIL_FROM: "e2e@example.com",
  GOOGLE_CLIENT_ID: "e2e-placeholder",
  GOOGLE_CLIENT_SECRET: "e2e-placeholder",
  GOOGLE_PLACES_API_KEY: "e2e-placeholder",
  // Telemetry goes nowhere: a closed local port.
  POSTHOG_ASSETS_HOST: "http://127.0.0.1:9",
  POSTHOG_HOST: "http://127.0.0.1:9",
  STRIPE_SECRET_KEY: "sk_test_e2e_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_e2e_placeholder",
};

const server = spawn(
  "npx",
  [
    "wrangler",
    "dev",
    "--port",
    String(E2E_PORT),
    "--ip",
    "127.0.0.1",
    "--persist-to",
    state,
    "--show-interactive-dev-session=false",
    ...Object.entries(vars).flatMap(([key, value]) => ["--var", `${key}:${value}`]),
  ],
  { cwd: root, stdio: "inherit" },
);

const stop = () => server.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
