#!/usr/bin/env node
// Starts the BUILT Worker (run `npm run build:cf` first) under `wrangler dev`
// for the end-to-end tests, with a fresh local D1 in e2e/.state: every file
// in migrations/, then prisma/seed-staging.sql. Playwright starts this as
// its web server (playwright.config.ts); it can also be run by hand.
//
// Runtime configuration comes from --var flags only: `--env-file
// e2e/empty.env` makes wrangler skip .dev.vars and .env, and the shell's
// environment is not copied in, so a developer's real keys are never used.
// None of the values are real credentials. wrangler dev has no switch to
// block the Worker's own outbound fetches; the tests keep it from making
// any instead (docs/TESTING.md, "End-to-end").
//
// Google sign-in is pointed at a local OpenID provider started here
// (src/test/helpers/oidcStub.ts, run by Node with its own type stripping),
// via GOOGLE_OAUTH_ISSUER_URL, so the real OAuth round trip runs with no call
// to Google.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  E2E_AUTH_SECRET,
  E2E_DELETING_MEMBER,
  E2E_GOOGLE_CLIENT,
  E2E_OIDC_ISSUER,
  E2E_OIDC_PORT,
  E2E_PORT,
} from "./config.mjs";

const root = path.resolve(import.meta.dirname, "..");
const state = path.join(root, "e2e", ".state");
const origin = `http://localhost:${E2E_PORT}`;

if (!existsSync(path.join(root, ".open-next", "worker.js"))) {
  console.error("No .open-next/worker.js: run `npm run build:cf` first.");
  process.exit(2);
}

// Wrangler's own usage metrics are not sent from test runs.
// The shell's environment never reaches the Worker either (wrangler only
// copies it when this is "true").
const spawnEnv = { ...process.env, CLOUDFLARE_INCLUDE_PROCESS_ENV: "false", WRANGLER_SEND_METRICS: "false" };

/** @param {string[]} args */
function wrangler(args) {
  const result = spawnSync("npx", ["wrangler", ...args], { cwd: root, env: spawnEnv, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

rmSync(state, { force: true, recursive: true });
wrangler(["d1", "migrations", "apply", "DB", "--local", "--persist-to", state]);
wrangler(["d1", "execute", "DB", "--local", "--persist-to", state, "--file", "prisma/seed-staging.sql"]);

/** The stub's subject for an address: stubSubject in src/test/helpers/oidcStub.ts. */
function stubSubject(/** @type {string} */ email) {
  return `stub-${createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 20)}`;
}

// Fixtures of the sign-in tests (e2e/signin.spec.ts): an account whose
// deletion has started, with its Google account still linked.
const fixtures = path.join(state, "fixtures.sql");
const now = new Date().toISOString();
writeFileSync(
  fixtures,
  [
    `INSERT INTO "User" (id, createdAt, updatedAt, firstName, lastName, email, isDeleted, deletionRequestedAt) VALUES ('${E2E_DELETING_MEMBER.id}', '${now}', '${now}', 'Leaving', 'Member', '${E2E_DELETING_MEMBER.email}', 1, '${now}');`,
    `INSERT INTO "Account" (id, userId, type, provider, providerAccountId) VALUES ('e2e_deleting_google', '${E2E_DELETING_MEMBER.id}', 'oidc', 'google', '${stubSubject(E2E_DELETING_MEMBER.email)}');`,
  ].join("\n"),
);
wrangler(["d1", "execute", "DB", "--local", "--persist-to", state, "--file", fixtures]);

const oidc = spawn(
  process.execPath,
  [
    "src/test/helpers/oidcStub.ts",
    "--port",
    String(E2E_OIDC_PORT),
    "--client-id",
    E2E_GOOGLE_CLIENT.clientId,
    "--client-secret",
    E2E_GOOGLE_CLIENT.clientSecret,
  ],
  { cwd: root, stdio: ["ignore", "pipe", "inherit"] },
);
// It prints its issuer once it is listening.
/** @type {Promise<string>} */
const oidcReady = new Promise((resolve, reject) => {
  oidc.once("exit", (code) => reject(new Error(`OIDC stub exited with ${String(code)}`)));
  oidc.stdout.once("data", (chunk) => resolve(String(chunk).trim()));
});
const issuer = await oidcReady;
if (issuer !== E2E_OIDC_ISSUER) throw new Error(`OIDC stub listening at ${issuer}, not ${E2E_OIDC_ISSUER}`);

const vars = {
  APP_ENV: "development",
  AUTH_SECRET: E2E_AUTH_SECRET,
  AUTH_URL: origin,
  CLOUDINARY_API_KEY: "e2e-placeholder",
  CLOUDINARY_API_SECRET: "e2e-placeholder",
  CLOUDINARY_CLOUD_NAME: "e2e-placeholder",
  EMAIL_FROM: "e2e@example.com",
  GOOGLE_CLIENT_ID: E2E_GOOGLE_CLIENT.clientId,
  GOOGLE_CLIENT_SECRET: E2E_GOOGLE_CLIENT.clientSecret,
  // Google sign-in goes to the local OpenID provider above.
  GOOGLE_OAUTH_ISSUER_URL: E2E_OIDC_ISSUER,
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
    // An explicit env file makes wrangler skip .dev.vars and .env: a
    // developer's real keys are never loaded (e2e/empty.env).
    "--env-file",
    "e2e/empty.env",
    ...Object.entries(vars).flatMap(([key, value]) => ["--var", `${key}:${value}`]),
  ],
  { cwd: root, env: spawnEnv, stdio: "inherit" },
);

const stop = () => {
  server.kill("SIGTERM");
  oidc.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
