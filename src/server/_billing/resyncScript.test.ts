import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ResyncBatchResult } from "./resync";

/**
 * scripts/billing-resync.mjs, run as a deployment job would run it, against
 * a server that answers `subscription.resyncFromStripe` with given batches.
 */

const SCRIPT = path.resolve(__dirname, "../../../scripts/billing-resync.mjs");

let server: Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

async function runAgainst(batches: ResyncBatchResult[]): Promise<{ code: number; output: string }> {
  let served = 0;
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const batch = batches[served];
      served += 1;
      res.writeHead(batch ? 200 : 500, { "content-type": "application/json" });
      res.end(JSON.stringify(batch ? { result: { data: { json: batch } } } : { error: { json: { message: "no more" } } }));
    });
  });
  const listening = server;
  await new Promise<void>((resolve) => listening.listen(0, "127.0.0.1", resolve));
  const { port } = listening.address() as AddressInfo;

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [SCRIPT, "--url", `http://127.0.0.1:${port}`],
      { env: { ...process.env, RESYNC_COOKIE: "session=test" } },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolve({ code, output: `${stdout}\n${stderr}` });
      },
    );
  });
}

describe("scripts/billing-resync.mjs", () => {
  it("exits 0 when every row is settled", async () => {
    const result = await runAgainst([
      { nextCursor: "row_2", outcomes: { applied: 2 }, processed: 2, unresolved: [] },
      { nextCursor: null, outcomes: { stale: 1 }, processed: 1, unresolved: [] },
    ]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("3 row(s) in 2 batch(es)");
  });

  it("exits 1 and names the rows when any row failed, even though every batch ran", async () => {
    const result = await runAgainst([
      { nextCursor: "row_2", outcomes: { applied: 1, failed: 1 }, processed: 2, unresolved: [{ id: "row_1", outcome: "failed" }] },
      { nextCursor: null, outcomes: { applied: 1 }, processed: 1, unresolved: [] },
    ]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("NOT complete");
    expect(result.output).toContain("Subscription row_1");
  });

  it("exits 3 and names the rows that need a person when nothing failed", async () => {
    const result = await runAgainst([
      { nextCursor: null, outcomes: { applied: 1, unknown_customer: 1 }, processed: 2, unresolved: [{ id: "row_9", outcome: "unknown_customer" }] },
    ]);

    expect(result.code).toBe(3);
    expect(result.output).toContain("Subscription row_9: unknown_customer");
  });

  it("exits 3 for a row that was applied but whose payment standing is incomplete, on every run until it is settled", async () => {
    const batch = { nextCursor: null, outcomes: { applied: 1 }, processed: 1, unresolved: [{ id: "row_4", outcome: "standing_incomplete" as const }] };

    for (const run of [1, 2]) {
      const result = await runAgainst([batch]);
      expect([run, result.code]).toEqual([run, 3]);
      expect(result.output).toContain("Subscription row_4: standing_incomplete");
    }
  });

  it("exits 1 when a batch cannot be run", async () => {
    expect((await runAgainst([])).code).toBe(1);
  });
});
