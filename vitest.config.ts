import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    coverage: {
      exclude: [
        "src/app/**",
        "src/test/**",
        "**/*.d.ts",
        "src/styles/**",
        "src/env.js",
        // Email templates require jsdom + React — covered separately
        "src/server/_lib/emails/**",
      ],
      include: ["src/**/*.{ts,tsx}"],
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      thresholds: {
        // Starting thresholds: achievable with current test suite.
        // Raise incrementally as more routers/modules get tests.
        branches: 18,
        functions: 16,
        lines: 22,
      },
    },
    env: {
      NODE_ENV: "test",
      SKIP_ENV_VALIDATION: "1",
    },
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
