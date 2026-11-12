#!/usr/bin/env node
// Triggers a Cron Trigger on a locally running Worker, the way Cloudflare
// would. Start the Worker first:
//
//   npm run build:cf && npx wrangler dev --test-scheduled
//
// then, in another terminal:
//
//   npm run jobs:local                       # every trigger, one after the other
//   npm run jobs:local -- "17 3 * * *"       # one trigger
//   npm run jobs:local -- --port 8787
//
// The cron expressions are the ones in wrangler.toml `[triggers]`. What each
// runs is defined in src/worker/scheduled.ts; the job's summary appears in
// the wrangler dev log.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { port: { default: "8787", type: "string" } },
});

/** Cron expressions of the top-level (production) environment. */
function configuredCrons() {
  const toml = readFileSync(path.join(repoRoot, "wrangler.toml"), "utf8");
  const match = /^\[triggers\]\ncrons = (\[.*\])$/m.exec(toml);
  if (!match?.[1]) throw new Error("No [triggers] crons found in wrangler.toml");
  /** @type {unknown} */
  const crons = JSON.parse(match[1]);
  if (!Array.isArray(crons)) throw new Error("[triggers] crons is not a list");
  return crons.map(String);
}

const crons = positionals.length > 0 ? positionals : configuredCrons();
let failed = false;

for (const cron of crons) {
  const url = `http://localhost:${values.port}/__scheduled?cron=${encodeURIComponent(cron)}`;
  try {
    const response = await fetch(url);
    const body = (await response.text()).trim();
    console.warn(`${cron}  ->  ${response.status} ${body}`);
    if (!response.ok) failed = true;
  } catch (error) {
    console.error(`${cron}  ->  could not reach ${url}. Is \`wrangler dev --test-scheduled\` running?`);
    console.error(error instanceof Error ? error.message : error);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
