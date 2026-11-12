# Testing

`npm test` runs Vitest. Database tests run against a real SQLite file built
from `migrations/` (`src/test/helpers/sqlite.ts`), so they see exactly the
schema D1 gets; routers are called through `createDbCaller`
(`src/test/helpers/dbCaller.ts`).

## Access rules the suite enforces

`src/server/api/root.test.ts` checks the whole API surface:

- **Public procedures** are listed in `PUBLIC_PROCEDURES`. Every other
  procedure must refuse an anonymous caller with `UNAUTHORIZED`.
- **Pro-only procedures must use `proProcedure`** (`src/server/api/trpc.ts`)
  and be listed in `PRO_PROCEDURES`. The test calls every procedure as a
  signed-in member without a subscription, each with the smallest input its
  schema accepts (`minimalInput`, `src/test/helpers/zodSample.ts`), so a Pro
  check written inside a resolver is reached too. It fails when a listed
  procedure does not answer `FORBIDDEN`, and when an unlisted one does: a
  hand-rolled Pro check is caught and must become `proProcedure`.
- A settled Pro subscription for a test user: `makePro`
  (`src/test/helpers/pro.ts`).

## Rate limits in tests

`freezeRateLimitClock()` (`src/test/helpers/rateLimitClock.ts`) pins the
limiter's window so a test cannot straddle two windows.
