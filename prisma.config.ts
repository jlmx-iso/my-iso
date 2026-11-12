import "dotenv/config";
import { defineConfig } from "prisma/config";

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
