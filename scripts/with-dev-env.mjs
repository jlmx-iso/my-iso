// Runs a command with the local development values from `.env.dev` added to
// its environment (variables already set win).
//
// Usage: node scripts/with-dev-env.mjs <command> [args...]
//        (npm run dev, start, typegen, dev:wrangler)
//
// Local values do not live in `.env`: OpenNext copies every env file Next.js
// loads by itself (`.env`, `.env.local`, `.env.<mode>`, `.env.<mode>.local`)
// into the Worker bundle, and scripts/deploy.mjs refuses to run while one
// exists (docs/DEPLOYMENT.md, "Local values"). `node --env-file` cannot be
// used instead: `next dev` passes Node's flags to its child process through
// NODE_OPTIONS, which does not allow it.
//
// Never use this for a deploy build: a deploy's values come from
// `.env.deploy.<environment>` only.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(repoRoot, ".env.dev");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/with-dev-env.mjs <command> [args...]");
  process.exit(2);
}
const result = spawnSync(command, args, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
if (result.error) {
  console.error(`Could not run ${command}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
