// Setup for DOM tests: browser APIs Mantine uses that happy-dom does not
// provide, per-test resets for the DOM test doubles, and the strict checks.
// Runs for every test file (vitest.config.ts setupFiles) but only does
// anything in files that opt into a DOM environment
// (`// @vitest-environment happy-dom`).

import { cleanNotifications } from "@mantine/notifications";
import { afterEach, beforeEach, expect } from "vitest";

import { testRouter } from "./navigation";
import { testSession } from "./session";
import { installStrictDomChecks } from "./strict";

const isDom = typeof document !== "undefined";

if (isDom) {
  // Unhandled tRPC calls and console.error fail the test (./strict.ts).
  installStrictDomChecks();
}

if (isDom && !("fonts" in document)) {
  // Mantine's autosizing Textarea listens for web fonts finishing loading.
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      check: () => true,
      ready: Promise.resolve(),
      status: "loaded",
    }),
  });
}

/**
 * No real outbound calls from a DOM test. tRPC goes through the in-process
 * link of renderWithProviders; anything else that reaches `fetch` (an image
 * host, an analytics beacon) is refused, and the test that tried fails,
 * naming the URL, even if the component swallowed the error.
 */
const unexpectedFetches: string[] = [];

if (isDom) {
  const refuse = (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    unexpectedFetches.push(url);
    return Promise.reject(new TypeError(`Unexpected outbound fetch in a DOM test: ${url}`));
  };
  globalThis.fetch = refuse;
  window.fetch = refuse;

  beforeEach(() => {
    unexpectedFetches.length = 0;
    testRouter.reset();
    testSession.reset();
  });

  afterEach(() => {
    cleanNotifications();
    expect(unexpectedFetches, "outbound fetch from a DOM test").toEqual([]);
  });
}
