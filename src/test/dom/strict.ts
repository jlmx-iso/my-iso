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
let allowed: Array<RegExp | null> = [];

/** Called by the mocked tRPC link for a procedure without a handler. */
export function recordUnhandledTrpcCall(description: string) {
  unhandledCalls.push(description);
}

/**
 * Lets this test log errors with console.error: those matching `pattern`,
 * or any error when called without one. Use it only where the error log is
 * the expected outcome (a failure path that the app reports with
 * `logger.error`), and match the message.
 */
export function allowConsoleError(pattern?: RegExp) {
  allowed.push(pattern ?? null);
}

function describe(args: unknown[]): string {
  return args
    .map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ")
    .slice(0, 2000);
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
  const unexpected = errorLogs.filter((log) => !allowed.some((pattern) => pattern === null || pattern.test(log)));
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
