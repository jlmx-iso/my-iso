import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

import { E2E_PORT } from "./e2e/config.mjs";

// A Chromium already on the machine (dev containers ship one here); otherwise
// Playwright's own, from `npx playwright install chromium`.
const PRESET_CHROMIUM = process.env.E2E_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

export default defineConfig({
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  outputDir: "test-results",
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  retries: 0,
  testDir: "e2e",
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${E2E_PORT}`,
    launchOptions: existsSync(PRESET_CHROMIUM) ? { executablePath: PRESET_CHROMIUM } : {},
    trace: "off",
  },
  webServer: {
    command: "node e2e/serve.mjs",
    // Migrating and seeding the local D1, then starting workerd.
    timeout: 180_000,
    url: `http://localhost:${E2E_PORT}/api/health`,
    // Locally, a server already running from `node e2e/serve.mjs` is reused.
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
  },
  workers: 1,
});
