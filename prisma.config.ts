import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Local development values live in `.env.dev`, a name Next.js and OpenNext
// never load by themselves (docs/DEPLOYMENT.md, "Local values").
config({ path: ".env.dev", quiet: true });

// `prisma generate` (run on postinstall and in CI) never connects to a
// database, so fall back to a local SQLite file when DATABASE_URL is unset.
// Commands that do connect (db push, studio) then target the same local dev
// database that `src/server/db.ts` uses for `file:` URLs.
const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: databaseUrl,
  },
});
