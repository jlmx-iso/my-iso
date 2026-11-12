import { readFileSync } from "fs";
import path from "path";

import { configDefaults, defineConfig } from "vitest/config";

// Kept in a JSON file so scripts/coverage-ratchet.mjs can raise the numbers
// when coverage rises. Never lower them by hand (docs/TESTING.md).
const coverageThresholds = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "coverage-thresholds.json"), "utf8"),
) as Record<string, unknown>;

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    coverage: {
      // Everything under src/ counts, including files no test imports (they
      // report 0%). Each exclusion below says why it cannot or need not run
      // under Vitest; the bar is documented in docs/TESTING.md.
      include: ["src/**/*.{ts,tsx,js}"],
      exclude: [
        // Tests and their helpers are not product code.
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        // Type-only: no runtime code to cover.
        "**/*.d.ts",
        "src/types/**",
        "src/_types/**",
        "src/styles/**",
        // Next.js route-convention files: async server components and
        // layouts that need the Next.js request scope (headers(), cookies(),
        // redirect(), the RSC tRPC caller). They are exercised by the build
        // and the workerd E2E smoke (npm run test:e2e), not Vitest. Route
        // handlers (route.ts), sitemap and robots are plain functions and stay
        // in.
        "src/app/**/{page,layout,loading,error,not-found,template,default,global-error}.tsx",
        // Browser bootstrap that runs PostHog init as an import side effect.
        "src/instrumentation-client.ts",
        // Next.js edge middleware: three lines of NextAuth wiring; the
        // config it uses (auth.config.ts) is covered.
        "src/middleware.ts",
        // Picks the Prisma driver from the runtime at import time (D1 inside
        // the Worker, a SQLite file in dev). Tests inject their own SQLite
        // client (src/test/helpers/sqlite.ts) and never import it.
        "src/server/db.ts",
        // The Durable Object class imports `cloudflare:workers`, which only
        // exists in workerd. Its decisions live in chatRoomPolicy.ts and
        // realtimeGateway.ts, which are covered.
        "src/do/ChatRoom.ts",
        // React Email templates: static markup with props. Sending logic
        // (email.ts) is covered; the templates are checked by the build.
        "src/server/_lib/emails/**",
      ],
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html", "lcov"],
      thresholds: coverageThresholds,
    },
    env: {
      NODE_ENV: "test",
      SKIP_ENV_VALIDATION: "1",
    },
    // Node by default. DOM tests opt in per file with a
    // `// @vitest-environment happy-dom` docblock (see docs/TESTING.md).
    environment: "node",
    // .claude/ can hold agent worktrees with their own copy of the suite.
    exclude: [...configDefaults.exclude, ".claude/**", "e2e/**"],
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
