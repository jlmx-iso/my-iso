// Browser APIs Mantine uses that happy-dom does not provide. Runs for every
// test file (vitest.config.ts setupFiles) but only does anything in files
// that opt into a DOM environment (`// @vitest-environment happy-dom`).

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
