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
   `migrations/0005_add_event_capacity.sql`. Names are `NNNN_description.sql`
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
| `InviteRedemption_count` | `0004` | On every new `InviteRedemption`, raises `InviteCode.redeemedCount`. Nothing lowers it, so a used invite stays used when the invited account is deleted; the `reconcile-invites` job reconciles against it. |
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

### `Message_touch_thread` in detail

`migrations/0003_billing_read_state_indexes.sql` creates it:

```sql
CREATE TRIGGER "Message_touch_thread" AFTER INSERT ON "Message"
BEGIN
  UPDATE "MessageThread" SET "updatedAt" = NEW."createdAt" WHERE "id" = NEW."threadId";
END;
```

It moves a conversation's activity time (`MessageThread.updatedAt`, which the
conversation list sorts by) in the same statement that inserts a message. D1
has no multi-statement transactions, so doing it from application code would
leave a window in which a sent message has not moved its thread.

What follows from Prisma not knowing about it:

- **`npm run db:check` does not detect its loss.** The check compares tables,
  columns and indexes; a database without the trigger still "matches".
- **Rebuilding the `Message` table drops it.** SQLite removes a table's
  triggers with the table, and Prisma's generated migrations rebuild a table
  (create `new_Message`, copy, drop `Message`, rename) for most column
  changes. **Any migration that rebuilds `Message` must end by creating the
  trigger again**, with the statement above. The next one that will is the
  removal of `Message.isRead` (below): SQLite's `ALTER TABLE ... DROP COLUMN`
  keeps the trigger, a rebuild does not. Prefer `DROP COLUMN`; if
  `db:migrate:diff` hands you a rebuild, append the `CREATE TRIGGER`.
- **The test that catches its loss** is `thread activity time > moves with
  the message insert itself (database trigger), for any writer` in
  `src/server/api/routers/message.test.ts`. Tests build their database from
  `migrations/`, so a migration that loses the trigger fails that test (and
  `a reply brings an older conversation back to the top` next to it).
- To check a deployed database:
  `wrangler d1 execute DB --remote --env staging --command "SELECT name FROM sqlite_master WHERE type = 'trigger'"`
  must list `Message_touch_thread`.

## Timestamps are text: one spelling

SQLite has no date type. Prisma stores a `DateTime` as ISO-8601 **text**,
and both adapters this project uses (`@prisma/adapter-d1` on Cloudflare,
`@prisma/adapter-better-sqlite3` in the tests) write it the same way:
milliseconds, and the offset spelled **`+00:00`**, for example
`2026-03-03T20:00:00.000+00:00`. The test "Prisma stores every timestamp in
ONE spelling" in `src/server/api/routers/event.test.ts` reads the stored
text and fails if an adapter upgrade changes this.

Comparisons and `ORDER BY` on these columns are comparisons of text. They
agree with time **only while every row uses the same spelling**:
`...000+00:00` and `...000Z` are the same instant, but `+` sorts before `Z`,
so two rows at one instant are ordered by their spelling before anything
else. The events feed pages by `(date, id)` and would skip or repeat an
event across such a pair; the unread counts and read state compare
`createdAt` the same way.

So:

- **Every write goes through Prisma, or writes the `+00:00` spelling.**
  Raw SQL in the app binds `Date` values as parameters (the adapter formats
  them). SQL written by hand (seed files, one-off fixes, migrations) must
  spell timestamps `strftime('%Y-%m-%dT%H:%M:%f+00:00', ...)` or as a
  literal ending in `+00:00`, never `Z` and never SQLite's
  `CURRENT_TIMESTAMP` format. `prisma/seed-staging.sql` and migration
  `0003` do.
- **Existing rows written with `Z`** (the staging seed did so before it was
  fixed; `INSERT OR IGNORE` leaves those rows as they are) are normalised
  once per database:

  ```sql
  UPDATE "Event" SET "date" = replace("date", 'Z', '+00:00') WHERE "date" LIKE '%Z';
  UPDATE "Event" SET "createdAt" = replace("createdAt", 'Z', '+00:00') WHERE "createdAt" LIKE '%Z';
  UPDATE "Event" SET "updatedAt" = replace("updatedAt", 'Z', '+00:00') WHERE "updatedAt" LIKE '%Z';
  ```

  (`wrangler d1 execute DB --remote --env staging --command "..."`.) Any
  other table a hand-written script has filled gets the same treatment for
  its `DateTime` columns; this finds them:

  ```sql
  SELECT 'Event' AS "table", COUNT(*) FROM "Event" WHERE "date" LIKE '%Z' OR "createdAt" LIKE '%Z'
  UNION ALL SELECT 'Message', COUNT(*) FROM "Message" WHERE "createdAt" LIKE '%Z'
  UNION ALL SELECT 'Booking', COUNT(*) FROM "Booking" WHERE "createdAt" LIKE '%Z';
  ```

The feed does recognise a `Z` row as being AT its cursor's instant (it
matches the instant as a range, not by equality), so rows at different
instants page correctly whatever their spelling; it is only the order
within one instant that needs the single spelling.

## Columns kept for the previous release (staged removal)

Migration `0003` left columns in place that the current code no longer
depends on. They are there because the release before it still reads or
writes them and, per the rule above, a migration must be something the
deployed code can live with:

| Columns | Why they are still there | What the current code does with them |
| --- | --- | --- |
| `Subscription.isTrial`, `isActive`, `isCanceled`, `isPaused`, `isPending`, `isExpired`, `expiresAt` | The previous release decides Pro access from `isActive` and writes these flags from its webhook | Writes them on every sync, derived from `status` (`legacyFlags` in `src/server/_billing/subscriptionStore.ts`), so a rollback finds them correct. Never decides anything from them: access comes from `status` and the columns described in `docs/BILLING.md`. The billing re-sync and the lazy first sync only look at them to recognise a row the previous release wrote (flags that contradict `status`, a null `expiresAt`) |
| `Message.isRead` | The previous release selects it | Neither reads nor writes it (read state is `ThreadRead`); queries omit it |
| `Event.isFulfilled` | Legacy: part of the baseline schema; the previous release neither reads nor writes it, so only earlier commits of this branch and ad-hoc queries ever did | **Neither reads nor writes it.** Whether an event is filled is derived from its bookings on every read (`withDerivedFulfilled` in `src/server/_db/bookingTransitions.ts`), so there is no second write that can fail and no stored value that can be wrong. The column keeps whatever it last held (default `false`) until it is dropped |

### Removal order

The `Subscription` flags decide the order: `isTrial`, `isActive`,
`isCanceled`, `isPaused`, `isPending` and `isExpired` are **`NOT NULL`
without a default** (`migrations/0001_init.sql`), so an insert that leaves
them out fails, and Prisma selects every column of a model unless told
otherwise, so a read fails once a column it still knows is gone. **Until
step 2 below has been applied, every release must keep writing the flags**
(`legacyFlags` in `subscriptionStore.ts`), on every insert and update.

1. **This release** (done): the code stops *depending* on the columns and
   keeps **writing** the `Subscription` flags. Deploy it, run the billing
   re-sync (`docs/BILLING.md`), and keep it deployed until a rollback to the
   release before it is no longer on the table.
2. **Migration: give the flags a default.** Add `@default(false)` to the six
   flags in `schema.prisma` and generate the migration. SQLite cannot add a
   default with `ALTER COLUMN`, so it is a rebuild of `Subscription`
   (`new_Subscription`, copy, drop, rename; see "Changing the schema" for
   the `PRAGMA` lines). Apply it while the code from step 1 is deployed:
   that code still writes every flag, so nothing changes for it.
3. **Code: stop writing and stop selecting.** Only now remove `legacyFlags`
   (inserts succeed on the defaults), and stop reading the columns at all:
   `omit` the seven `Subscription` columns and `Event.isFulfilled` in the
   Prisma client (as the message queries already do with
   `omit: { isRead: true }`), and remove the "pending" scope's legacy
   conditions in `src/server/_billing/resync.ts` together with
   `rowNeedsFirstSync`'s. The fields stay in `schema.prisma`, so
   `npm run db:check` still passes. Deploy, and keep it deployed until a
   rollback to step 1's code is off the table (that code would find flags
   no longer kept up to date).
4. **Migration, then code: drop.** Remove the fields from `schema.prisma`
   and the `omit`s, and add the migration:

   ```sql
   ALTER TABLE "Subscription" DROP COLUMN "isTrial";
   -- ... likewise isActive, isCanceled, isPaused, isPending, isExpired, expiresAt
   ALTER TABLE "Message" DROP COLUMN "isRead";
   ALTER TABLE "Event" DROP COLUMN "isFulfilled";
   ```

   Apply it while the code from step 3 is deployed (it neither writes nor
   selects the columns), then deploy.

What must not be done is what this section used to describe: deploy code
that no longer writes the flags while they are still `NOT NULL` without a
default (no subscription row could be created until the drop), or drop the
columns while the deployed code still writes or selects them.

`isLifetime` stays: it is how a comped account is recorded. If a migration
is generated as a table rebuild instead of `DROP COLUMN`, see the trigger
note above before applying it to `Message`.

`Event.isFulfilled` has a default and no reader in either release, so it
can be dropped with the others without a step of its own. An ad-hoc query
that wants the value computes it:

```sql
SELECT e."id", EXISTS (
  SELECT 1 FROM "Booking" b
  WHERE b."eventId" = e."id" AND NOT b."isDeleted" AND b."status" IN ('accepted', 'completed')
) AS "isFulfilled" FROM "Event" e;
```

Doing it in one step (dropping the columns in the same release that stops
using them) would break the still-running previous release for the length of
the deploy, and make a rollback impossible.

## Local D1 from scratch

```sh
rm -rf .wrangler/state/v3/d1      # optional: start empty
npm run db:migrate:local
npm run db:seed:local             # optional demo data
npm run dev:wrangler
```

## Upgrading a database created before the baseline

The two existing databases were created before the baseline. Run
`npm run db:upgrade-legacy -- --env staging`, check the app on staging, then
production.

In more detail. `migrations/0001_init.sql` is a baseline: it creates the
whole schema in an empty database. The staging (`my-iso-db-staging`) and
production (`my-iso-db`) databases were created earlier, from `main` at
`2d1d630` (staging also seeded with that commit's `prisma/seed-staging.sql`),
and have no record of `0001_init.sql`. Applying migrations to them would fail
on the first `CREATE TABLE`, so `npm run deploy:<env>` checks first and stops
with the command to run.

```sh
npm run db:upgrade-legacy -- --env staging          # checks, backs up, shows what is removed; changes nothing
npm run db:upgrade-legacy -- --env staging --yes    # the same, then upgrades and verifies
npm run deploy:staging                              # applies 0003 onwards, deploys
# check the app on staging, then the same three commands with --env production / deploy:production
```

`scripts/db-upgrade-legacy.mjs`, in order, stopping at the first problem:

1. refuses a database that already has `0001_init.sql` recorded, or has no
   app tables;
2. exports the schema (`wrangler d1 export --no-data`) and refuses unless it
   is exactly `migrations/legacy/pre-baseline-schema.sql` (the schema of
   `prisma/schema.prisma` at `2d1d630`), so the upgrade never half-applies to
   a database it was not written for;
3. exports a full backup to `backups/<env>-<timestamp>.sql` (gitignored:
   real data; keep it somewhere safe and delete it when no longer needed);
4. prints how many rows the upgrade will remove from each table (of each
   duplicated group it keeps one row; all pending `VerificationToken` rows
   go), and without `--yes` stops there;
5. takes a D1 Time Travel bookmark of the database as it is now, prints it
   and saves it next to the backup (`backups/<env>-<timestamp>.bookmark`),
   then runs `migrations/legacy/upgrade-pre-baseline.sql`
   (`wrangler d1 execute --remote --file`);
6. exports the schema again and checks it is exactly the baseline, and that
   `0001_init.sql` is recorded.

**Availability.** D1 is unavailable to the app while it exports and while
it runs the upgrade file. Every run takes at least two exports (the schema
check and the full backup), the dry run without `--yes` included: on
production, run even the dry run off-peak.

**Rollback.** The `.sql` backup cannot be replayed over the existing
database (its `CREATE TABLE`s would collide). The way back is D1 Time
Travel, to the bookmark taken just before the upgrade, within 30 days:

```sh
npx wrangler d1 time-travel restore DB --bookmark=<id from backups/<env>-<timestamp>.bookmark> --env staging
# production: ... --env=
```

The script prints this command, with the bookmark filled in, whenever a step
fails after the upgrade has started and when it finishes. If the upgrade
step itself fails (a timeout, a dropped connection, Ctrl-C), whether it was
applied is not known: run the script again without `--yes`. It reports
"already has the baseline recorded" (applied) or checks the pre-baseline
schema again (not applied).

What `upgrade-pre-baseline.sql` does (`src/server/_db/legacyUpgrade.test.ts`
runs it on the pre-baseline schema with the old staging seed and checks the
result against `0001_init.sql` on an empty database, then against the full
migration chain):

- **Timestamps to one spelling** (see "Timestamps are text"): every
  `DATETIME` column, every text value not already in Prisma's exact form
  (`2026-02-24T12:00:00.000+00:00`: milliseconds and `+00:00`). The old
  staging seed wrote `...Z`; production rows written by the app are already
  in that form and are not touched.
- **De-duplicates** for the unique indexes the baseline adds: one
  `EventLike` per (event, user), keeping a live one, else the oldest; one
  `CommentLike` per (comment, user), the same rule; one `Review` per
  (photographer, reviewer), keeping the most recently edited; one
  `InviteRedemption` per member, keeping the first
  (`InviteCode.currentRedemptions` is left to the reconcile job).
- **Sign-in codes**: drops the unique index `VerificationToken_token_key` (a
  code is unique per address, not globally) and discards pending codes. That
  also discards any outstanding email-verification links (the code at
  `2d1d630` kept those in the same table): those members have to request a
  new link.
- Adds what the baseline has and the old schema lacks
  (`VerificationToken.attempts`, `MessageThread.participantKey`, the
  `RateLimit` table, the new indexes), with `ALTER TABLE`: no table is
  rebuilt, because dropping `User` would cascade-delete every row that
  references it.
- Records `0001_init.sql` in `d1_migrations`, created exactly as wrangler
  creates it.

`wrangler d1 migrations apply` reads only `migrations/*.sql`, not
subdirectories, so nothing under `migrations/legacy/` is ever applied as a
migration.

Note: `migrations/schema.sql` at `2d1d630` is not the schema of those
databases. It was stale (no `InviteCode`, `InviteRedemption`, `Waitlist`,
`PendingInviteValidation` or `User.role`, a `Referral` table), and its first
line is Prisma CLI output, so it cannot be executed as it is. The databases
match that commit's `prisma/schema.prisma`, which the staging seed needs.

### Appendix: any other database created before the baseline

For a database that is neither of the two above (`db:upgrade-legacy` refuses
anything whose schema differs from the expected one), the same steps by
hand. Staging first.

1. **Back up, and note a Time Travel bookmark** (the rollback; see above).

   ```sh
   wrangler d1 export DB --remote --env staging --output backups/staging-manual.sql
   wrangler d1 time-travel info DB --env staging
   ```

2. **Look at what would be removed.** Rows the de-duplication removes, per
   table (each duplicated group keeps one row):

   ```sql
   SELECT 'EventLike' AS "table", COALESCE(SUM("n" - 1), 0) AS "rowsRemoved" FROM (
     SELECT COUNT(*) AS "n" FROM "EventLike" GROUP BY "eventId", "userId" HAVING COUNT(*) > 1
   )
   UNION ALL SELECT 'CommentLike', COALESCE(SUM("n" - 1), 0) FROM (
     SELECT COUNT(*) AS "n" FROM "CommentLike" GROUP BY "commentId", "userId" HAVING COUNT(*) > 1
   )
   UNION ALL SELECT 'Review', COALESCE(SUM("n" - 1), 0) FROM (
     SELECT COUNT(*) AS "n" FROM "Review" GROUP BY "photographerId", "userId" HAVING COUNT(*) > 1
   )
   UNION ALL SELECT 'InviteRedemption', COALESCE(SUM("n" - 1), 0) FROM (
     SELECT COUNT(*) AS "n" FROM "InviteRedemption" GROUP BY "redeemedById" HAVING COUNT(*) > 1
   );
   ```

   If `Review` or `InviteRedemption` report any, look at the rows first.

3. **Bring the schema to the baseline.** Start from
   `migrations/legacy/upgrade-pre-baseline.sql`: it is written for a
   database whose schema is `migrations/legacy/pre-baseline-schema.sql`.
   Compare yours with that (export it with `--no-data`), adjust a copy of the
   file for the differences, and run it with
   `wrangler d1 execute DB --remote --env staging --file <copy>`.

4. **Confirm the database now matches the schema.**

   ```sh
   wrangler d1 export DB --remote --env staging --no-data --output staging-schema.sql
   sqlite3 staging-schema.sqlite < staging-schema.sql
   DATABASE_URL=file:./staging-schema.sqlite \
     npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
   ```

   Against the baseline alone (before 0003 onwards are applied) the diff
   lists what those migrations add; once they are applied it must be
   `-- This is an empty migration.` (`d1_migrations` shows up as a table to
   drop: ignore it).

5. **Record the baseline as applied**, if your copy of the file did not:

   ```sql
   CREATE TABLE IF NOT EXISTS "d1_migrations"(
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     name       TEXT UNIQUE,
     applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
   );
   INSERT INTO "d1_migrations" (name) VALUES ('0001_init.sql');
   ```

   `wrangler d1 migrations list DB --remote --env staging` must then list
   only the migrations after `0001`. From here on the database is migrated
   like any other.
