// Keeps the example env files, the CI placeholders and wrangler.toml in step
// with the schema in src/env.js.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const schemaSource = read("src/env.js");

/** Keys of the object literal that follows `<name>: {` in src/env.js. */
function schemaKeys(block: "client" | "runtimeEnv" | "server"): string[] {
  const start = schemaSource.indexOf(`\n  ${block}: {`);
  expect(start, `block "${block}" in src/env.js`).toBeGreaterThan(-1);
  const end = schemaSource.indexOf("\n  },", start);
  const body = schemaSource.slice(start, end);
  return [...body.matchAll(/^\s{4}([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1] ?? "").sort();
}

/** Variable names assigned in a dotenv-style file (comments ignored). */
function dotenvKeys(file: string): string[] {
  return [...read(file).matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1] ?? "").sort();
}

const client = schemaKeys("client");
const server = schemaKeys("server");
const all = [...client, ...server].sort();

/** Server variables a Worker does not take from `.dev.vars`; see that file. */
const NOT_IN_DEV_VARS = ["DATABASE_URL", "NODE_ENV"];

describe("src/env.js", () => {
  it("has a schema to check against", () => {
    expect(client).toContain("NEXT_PUBLIC_BASE_URL");
    expect(server).toContain("AUTH_SECRET");
    expect(new Set(all).size).toBe(all.length);
  });

  it("only exposes NEXT_PUBLIC_ variables to the browser", () => {
    for (const key of client) expect(key).toMatch(/^NEXT_PUBLIC_/);
    for (const key of server) expect(key).not.toMatch(/^NEXT_PUBLIC_/);
  });

  it("maps every variable in runtimeEnv, and nothing else", () => {
    expect(schemaKeys("runtimeEnv")).toEqual(all);
  });

  it("no longer knows the variables that were removed", () => {
    for (const gone of ["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN", "NEXT_PUBLIC_POSTHOG_HOST", "POSTHOG_API_KEY"]) {
      expect(all).not.toContain(gone);
    }
  });
});

describe("example env files", () => {
  it(".env.example lists exactly the variables of the schema", () => {
    expect(dotenvKeys(".env.example")).toEqual(all);
  });

  it(".dev.vars.example lists exactly the runtime variables a Worker reads", () => {
    const expected = server.filter((key) => !NOT_IN_DEV_VARS.includes(key));
    expect(dotenvKeys(".dev.vars.example")).toEqual(expected);
  });

  it(".env.deploy.example lists exactly the build-time variables, plus the upload credentials", () => {
    const expected = [
      // Set by scripts/deploy.mjs from the environment name.
      ...client.filter((key) => key !== "NEXT_PUBLIC_APP_ENV"),
      "POSTHOG_CLI_API_KEY",
      "POSTHOG_CLI_HOST",
      "POSTHOG_CLI_PROJECT_ID",
    ].sort();
    expect(dotenvKeys(".env.deploy.example")).toEqual(expected);
  });

  it("contain no real-looking secrets", () => {
    for (const file of [".env.example", ".dev.vars.example", ".env.deploy.example"]) {
      expect(read(file)).not.toMatch(/sk_live_|sk_test_[A-Za-z0-9]{8,}|phc_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{8,}/);
    }
  });
});

describe("configuration outside the schema", () => {
  it("CI placeholders are all variables the schema knows", () => {
    const workflow = read(".github/workflows/ci.yml");
    const envBlock = /^env:\n((?: {2}.*\n|\n)+)/m.exec(workflow)?.[1] ?? "";
    const names = [...envBlock.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1] ?? "");
    expect(names.length).toBeGreaterThan(5);
    const known = new Set([...all, "NEXT_TELEMETRY_DISABLED"]);
    for (const name of names) expect(known.has(name), name).toBe(true);
  });

  it("wrangler.toml [vars] are runtime variables the schema knows", () => {
    const toml = read("wrangler.toml");
    const blocks = [...toml.matchAll(/^\[(?:env\.\w+\.)?vars\]\n((?:(?!\[).*\n)*)/gm)];
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      const names = [...(block[1] ?? "").matchAll(/^([A-Z][A-Z0-9_]*) =/gm)].map((match) => match[1] ?? "");
      expect(names).toContain("APP_ENV");
      for (const name of names) expect(server, name).toContain(name);
    }
  });
});
