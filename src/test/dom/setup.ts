// Setup for DOM tests. Runs for every test file (vitest.config.ts
// setupFiles) but only does anything in files that opt into a DOM
// environment (`// @vitest-environment happy-dom`).

import { installStrictDomChecks } from "./strict";

if (typeof document !== "undefined") {
  // Unhandled tRPC calls and console.error fail the test (./strict.ts).
  installStrictDomChecks();
}

// Browser APIs Mantine uses that happy-dom does not provide.
if (typeof document !== "undefined" && !("fonts" in document)) {
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

export {};
