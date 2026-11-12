import { format } from "node:util";

import { afterEach, beforeEach, vi } from "vitest";

/**
 * Strict DOM tests: a DOM test fails when
 *
 *  - the component called a tRPC procedure the test gave no handler for
 *    (renderWithProviders records it; the call itself fails too), or
 *  - anything was logged with console.error: React's act() warnings, render
 *    errors, key warnings, and the app's own `logger.error`.
 *
 * A test that expects an error log says so with `allowConsoleError`.
 * Installed for DOM test files by src/test/dom/setup.ts.
 */

const unhandledCalls: string[] = [];
let errorLogs: string[] = [];
let allowed: RegExp[] = [];

/** Called by the mocked tRPC link for a procedure without a handler. */
export function recordUnhandledTrpcCall(description: string) {
  unhandledCalls.push(description);
}

/** Unrelated strings that no pattern for one real log message matches. */
const UNRELATED = ["qzxv", "0", "§¶", "an unrelated log line"];

/**
 * Lets this test log errors with console.error that match one of
 * `patterns`. Use it only where the error log is the expected outcome (a
 * failure path that the app reports with `logger.error`), and match that
 * message: at least one pattern is required, and a pattern that matches
 * anything (an empty one, /./, /.*\/, /[\s\S]*\/) is refused.
 */
export function allowConsoleError(...patterns: [RegExp, ...RegExp[]]) {
  if (patterns.length === 0) {
    throw new Error("allowConsoleError needs the pattern of the error message the test expects.");
  }
  for (const pattern of patterns) {
    if (!(pattern instanceof RegExp)) {
      throw new Error(`allowConsoleError takes regular expressions, got ${String(pattern)}`);
    }
    if (pattern.source === "" || pattern.source === "(?:)" || UNRELATED.every((text) => pattern.test(text))) {
      throw new Error(`allowConsoleError: ${String(pattern)} matches any message; match the expected one.`);
    }
    pattern.lastIndex = 0;
  }
  allowed.push(...patterns);
}

/** The log line as the console would print it (React passes "%s" formats). */
function describe(args: unknown[]): string {
  return format(...args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : arg))).slice(0, 2000);
}

/** Forgets what this test recorded and allowed. */
export function resetStrictDomRun() {
  unhandledCalls.length = 0;
  errorLogs = [];
  allowed = [];
}

/** Throws if this test made an unhandled tRPC call or an unexpected error log. */
export function checkStrictDomRun() {
  const unhandled = [...unhandledCalls];
  const unexpected = errorLogs.filter((log) => !allowed.some((pattern) => { pattern.lastIndex = 0; return pattern.test(log); }));
  if (unhandled.length > 0) {
    throw new Error(
      `The component called tRPC procedures this test has no handler for:\n  ${unhandled.join("\n  ")}\n` +
        "Give each one a handler in renderWithProviders({ trpc }).",
    );
  }
  if (unexpected.length > 0) {
    throw new Error(
      `console.error was called during this test:\n  ${unexpected.join("\n  ")}\n` +
        "Fix the cause (an act() warning, a render error), or, if the error log is the expected " +
        "outcome, call allowConsoleError(/message/) in the test.",
    );
  }
}

export function installStrictDomChecks() {
  beforeEach(() => {
    resetStrictDomRun();
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errorLogs.push(describe(args));
    });
  });

  afterEach(() => {
    try {
      checkStrictDomRun();
    } finally {
      resetStrictDomRun();
    }
  });
}
