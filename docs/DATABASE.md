# Database and migrations

The app's database is Cloudflare D1 (SQLite). Prisma is the query layer; the
schema is described in `prisma/schema.prisma`.

Two things describe the schema and they must always agree:

| What | Where | Used for |
| --- | --- | --- |
| The Prisma schema | `prisma/schema.prisma` | Generating the Prisma client; the source you edit |
| The migrations | `migrations/NNNN_name.sql` | What is actually applied to D1 (staging, production, local) |

`npm run db:check` (also a CI step) fails when they disagree. It applies every
file in `migrations/` in order to a scratch SQLite database and asks Prisma
whether that database differs from the schema.

The test suite builds its databases from `migrations/` too, so tests run
against exactly what D1 gets.

## The rule: migrations first, then code

**Apply migrations before deploying the code that needs them.**

`npm run deploy:staging` and `npm run deploy:production` do this for you:
they build, apply pending migrations, and only then deploy
(`scripts/deploy.mjs`, [DEPLOYMENT.md](DEPLOYMENT.md)). To migrate without
deploying:

```sh
npm run db:migrate:staging
npm run db:migrate:production
```

D1 has no way to deploy schema and code atomically, so for a moment the old
code runs against the new schema. Write migrations that the *currently
deployed* code can live with:

- Adding a table, a nullable column, a column with a default, or an index is
  safe.
- Removing or renaming something the deployed code still uses is not. Do it
  in two releases: first deploy code that no longer uses it, then migrate.
- A new unique index fails if the data already violates it. De-duplicate in
  the same migration, before the `CREATE UNIQUE INDEX`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run db:check` | Fails if `migrations/` and `prisma/schema.prisma` are out of sync |
| `npm run db:migrate:diff` | Prints the SQL that brings `migrations/` up to the schema (the body of your next migration) |
| `npm run db:migrate:local` | Applies pending migrations to the local D1 that `wrangler dev` uses (`.wrangler/state`) |
| `npm run db:migrate:staging` | Applies pending migrations to the staging D1 |
| `npm run db:migrate:production` | Applies pending migrations to the production D1 |
| `npm run db:seed:local` / `db:seed:staging` | Loads `prisma/seed-staging.sql` (demo data; idempotent) |

`wrangler d1 migrations apply` records each applied file in a `d1_migrations`
table inside the database and only runs files that are not listed there. It
shows what it is about to apply and asks for confirmation (it applies without
asking when `CI=true`). `wrangler d1 migrations list DB --remote [--env staging]`
shows what is pending without applying anything.

## Changing the schema

1. Edit `prisma/schema.prisma`.
2. Print the SQL for the change:

   ```sh
   npm run db:migrate:diff
   ```

3. Save it as the next numbered file, for example
   `migrations/0002_add_event_capacity.sql`. Names are `NNNN_description.sql`
   (lower case, digits and underscores); files are applied in name order.
4. Read the SQL before you commit it. Prisma writes it for plain SQLite:
   - When a change cannot be done with `ALTER TABLE` (dropping a column
     default, changing a type, ...), Prisma rebuilds the table: it creates
     `new_X`, copies the rows, drops `X` and renames. That block is wrapped in
     `PRAGMA foreign_keys=OFF/ON`, which D1 ignores. Keep the
     `PRAGMA defer_foreign_keys=ON` line that Prisma also emits (D1 honours
     that one) and delete the `foreign_keys` lines.
   - Do not add `BEGIN`/`COMMIT`: D1 rejects explicit transactions. A
     migration file already runs as one unit, and is rolled back if a
     statement fails.
   - Add any data fix the change needs (back-filling a new column,
     de-duplicating before a unique index) to the same file, in the right
     place.
5. `npm run db:check` must now pass, and `npm test` runs against the new
   schema.
6. Try it locally: `npm run db:migrate:local`, then `npm run dev:wrangler`.
7. After review: `npm run deploy:staging`, check it, then
   `npm run deploy:production` (each applies its migrations first).

Never edit or delete a migration that has been applied anywhere. Fix a
mistake with a new migration.

`npm run db:push` (`prisma db push`) is only for the throwaway SQLite file
that `next dev` uses (`DATABASE_URL=file:./dev.db`). It never touches D1 and
is not a substitute for a migration.

## Triggers

Two things are kept consistent by SQLite triggers, because D1 has no
multi-statement transactions and each must change together with the row that
causes it:

| Trigger | Created in | What it does |
| --- | --- | --- |
| `InviteRedemption_count` | `0002` | On every new `InviteRedemption`, raises `InviteCode.redeemedCount`. Nothing lowers it, so a used invite stays used when the invited account is deleted; the `reconcile-invites` job reconciles against it. |
| `Message_touch_thread` | `0003` | On every new `Message`, sets `MessageThread.updatedAt` to the message's `createdAt`, so the conversation list (sorted by it) can never show a thread in its old position after a send. |

Prisma does not know about triggers: they are not in `schema.prisma`,
`npm run db:migrate:diff` never emits them and `npm run db:check` does not
compare them. They exist only in the migration files. The tests run with
them, because test databases are built from `migrations/`. Consequences:

- Do not set `MessageThread.updatedAt` or `InviteCode.redeemedCount` from
  application code; the trigger owns them.
- If a migration has to rebuild `Message` or `InviteRedemption` (Prisma's
  `new_X` / copy / drop / rename block), the trigger is dropped with the old
  table: re-create it at the end of that migration.
- `prisma db push` (the `next dev` SQLite file) does not create them.

## Local D1 from scratch

```sh
rm -rf .wrangler/state/v3/d1      # optional: start empty
npm run db:migrate:local
npm run db:seed:local             # optional demo data
npm run dev:wrangler
```

## Upgrading a database created before the baseline

`migrations/0001_init.sql` is a baseline: it creates the whole schema in an
empty database. A D1 database that already existed before this baseline
(created with `prisma db push` or the old `migrations/schema.sql`) **must not
have `0001_init.sql` applied to it**: its tables already exist and the file
would fail on the first `CREATE TABLE`.

Such a database has to be brought to the baseline schema by hand, once, and
then told that the baseline is applied. Compared with the schema before the
baseline, the baseline adds unique indexes that existing data may violate, so
the data **must be de-duplicated** on:

- `EventLike (eventId, userId)`
- `CommentLike (commentId, userId)`
- `Review (photographerId, userId)`
- `InviteRedemption (redeemedById)`

and the unique index **`VerificationToken_token_key` must be dropped** (a
6-digit sign-in code is unique per address, not across all addresses; with
the index in place two people cannot hold the same code at the same time).

None of this is applied automatically. Do it deliberately, per database,
staging first.

### 1. Back up

```sh
wrangler d1 export DB --remote --env staging --output backup-staging.sql
# production: wrangler d1 export DB --remote --env="" --output backup-production.sql
```

### 2. Look at what would be removed

```sql
SELECT 'EventLike' AS "table", COUNT(*) AS "extraRows" FROM (
  SELECT 1 FROM "EventLike" GROUP BY "eventId", "userId" HAVING COUNT(*) > 1
)
UNION ALL SELECT 'CommentLike', COUNT(*) FROM (
  SELECT 1 FROM "CommentLike" GROUP BY "commentId", "userId" HAVING COUNT(*) > 1
)
UNION ALL SELECT 'Review', COUNT(*) FROM (
  SELECT 1 FROM "Review" GROUP BY "photographerId", "userId" HAVING COUNT(*) > 1
)
UNION ALL SELECT 'InviteRedemption', COUNT(*) FROM (
  SELECT 1 FROM "InviteRedemption" GROUP BY "redeemedById" HAVING COUNT(*) > 1
);
```

(The counts are the number of duplicated *groups*.) If `Review` or
`InviteRedemption` report any, look at the rows before deleting: the SQL
below keeps the most recently edited review and the first redemption, and
does not adjust `InviteCode.currentRedemptions`.

### 3. De-duplicate, drop the index, apply the rest of the change

Save as a file and run it with
`wrangler d1 execute DB --remote --env staging --file upgrade.sql`. This is
the change from the schema on `main` before the baseline to the baseline. It
has been checked against a database with that schema; step 4 checks it
against yours.

```sql
-- 1. De-duplicate, so the new unique indexes can be created.

-- One like per (event, user): keep a live one if there is one, else the oldest.
DELETE FROM "EventLike" WHERE "id" NOT IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "eventId", "userId" ORDER BY "isDeleted" ASC, "createdAt" ASC, "id" ASC
    ) AS "position" FROM "EventLike"
  ) WHERE "position" = 1
);

-- One like per (comment, user): same rule.
DELETE FROM "CommentLike" WHERE "id" NOT IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "commentId", "userId" ORDER BY "isDeleted" ASC, "createdAt" ASC, "id" ASC
    ) AS "position" FROM "CommentLike"
  ) WHERE "position" = 1
);

-- One review per (photographer, reviewer): keep the most recently edited.
DELETE FROM "Review" WHERE "id" NOT IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "photographerId", "userId" ORDER BY "updatedAt" DESC, "id" DESC
    ) AS "position" FROM "Review"
  ) WHERE "position" = 1
);

-- One invite redemption per user: keep the first.
DELETE FROM "InviteRedemption" WHERE "id" NOT IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "redeemedById" ORDER BY "redeemedAt" ASC, "id" ASC
    ) AS "position" FROM "InviteRedemption"
  ) WHERE "position" = 1
);

-- 2. Sign-in codes: a 6-digit code is unique per address, not globally.
--    Pending codes are short-lived; they are discarded.
DROP INDEX IF EXISTS "VerificationToken_token_key";
DELETE FROM "VerificationToken";
ALTER TABLE "VerificationToken" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "VerificationToken_expires_idx" ON "VerificationToken"("expires");

-- 3. The rest of the schema change.
DROP INDEX "InviteRedemption_redeemedById_idx";
DROP INDEX "InviteRedemption_inviteCodeId_redeemedById_key";
CREATE UNIQUE INDEX "InviteRedemption_redeemedById_key" ON "InviteRedemption"("redeemedById");
CREATE INDEX "InviteRedemption_inviteCodeId_idx" ON "InviteRedemption"("inviteCodeId");

CREATE UNIQUE INDEX "EventLike_eventId_userId_key" ON "EventLike"("eventId", "userId");
CREATE UNIQUE INDEX "CommentLike_commentId_userId_key" ON "CommentLike"("commentId", "userId");
CREATE UNIQUE INDEX "Review_photographerId_userId_key" ON "Review"("photographerId", "userId");

ALTER TABLE "MessageThread" ADD COLUMN "participantKey" TEXT;
CREATE UNIQUE INDEX "MessageThread_participantKey_key" ON "MessageThread"("participantKey");

CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" INTEGER NOT NULL,

    PRIMARY KEY ("key", "windowStart")
);
CREATE INDEX "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");
```

If a statement fails because your database differs from what this expects (a
table or index that is missing or already there), nothing from the file is
kept. Use step 4 to see the real difference and adjust.

### 4. Confirm the database now matches the schema

Nobody has recorded how each existing database was created, so do not assume
step 3 was everything. Compare the real schema with the Prisma schema:

```sh
wrangler d1 export DB --remote --env staging --no-data --output staging-schema.sql
sqlite3 staging-schema.sqlite < staging-schema.sql
DATABASE_URL=file:./staging-schema.sqlite \
  npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

The output must be `-- This is an empty migration.` (Tables that Prisma does
not manage, such as `d1_migrations`, show up as tables to drop: ignore
those.) Anything else is SQL the database still needs: review it, apply it
with `wrangler d1 execute`, and repeat until the diff is empty.

### 5. Record the baseline as applied

```sql
CREATE TABLE IF NOT EXISTS d1_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO d1_migrations (name) VALUES ('0001_init.sql');
```

`wrangler d1 migrations list DB --remote --env staging` must now report that
there is nothing to apply. From here on the database is migrated like any
other: `npm run db:migrate:staging`.

Only after steps 1 to 5 have succeeded on a database may the code from the
security-hardening release be deployed against it: that code relies on the
unique indexes and the `RateLimit` table (sign-in codes, invites and the
waitlist fail closed without the limiter's table).
