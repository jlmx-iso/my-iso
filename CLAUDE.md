# ISO (my-iso)

An invite-only network where lead photographers find second shooters.
`README.md` has the stack and the commands; this file is what to know before
changing code.

## Stack in one paragraph

Next.js 16 App Router + React 19 + Mantine 9 + tRPC 11, deployed to
Cloudflare Workers with OpenNext behind a custom entry (`worker.ts`). Data is
Cloudflare D1 through Prisma 7. Auth.js v5 (Google and emailed codes, JWT
sessions). PostHog for analytics, replay, flags and error tracking. Resend
for email, Cloudinary for images, Stripe for payments, Claude for match
summaries and icebreakers. npm 11, Node 26.

## Commands

```sh
npm run dev            # next dev on Node with SQLite (fast; not the real runtime)
npm run dev:wrangler   # the built Worker on workerd with local D1 (the real runtime)
npm run lint && npm run typecheck && npm test && npm run db:check
npm run build:cf && npm run check:bundle
```

All six must pass before a change is done. Tests are Vitest; database tests
use a real SQLite built from `migrations/` (`src/test/helpers/sqlite.ts`).

## Rules that are easy to break

**The runtime is a Worker.** An isolate can stop as soon as the response is
sent. Never leave a promise floating: await it, or hand it to
`runAfterResponse` (`src/server/_lib/background.ts`), which uses `waitUntil`
and reports failures. No module-level long-lived clients, timers or caches
that must survive between requests.

**D1 has no interactive transactions** and allows about 100 bound parameters
per statement. Do not use `$transaction(async (tx) => ...)`. Make multi-step
writes safe with unique constraints, single conditional statements
(`UPDATE ... WHERE <condition>`, then check the affected rows) and idempotent
retries: see `src/server/_db/invite.ts`. Keep `IN (...)` lists and `take`
with nested relations under ~90 rows.

**Schema changes need a migration.** Edit `prisma/schema.prisma`, then
`npm run db:migrate:diff` and save the SQL as the next
`migrations/NNNN_name.sql`. Migrations are applied before the code that needs
them, so they must be additive (`docs/DATABASE.md`).

**Environment variables live in `src/env.js`**, validated with Zod. Adding
one means: the schema and `runtimeEnv` there, `.env.example`,
`.dev.vars.example` if it is a runtime variable, and `docs/DEPLOYMENT.md`.
`src/env.test.ts` fails when they drift. `NEXT_PUBLIC_*` values are inlined
at build time; everything else is read at runtime.

**Absolute URLs come from `~/_lib/site`** (`SITE_URL`, from
`NEXT_PUBLIC_BASE_URL`). Do not hard-code the domain or an email address.

**Telemetry is first-party.** The browser talks to PostHog only through
`/lens` on the app's own origin (`worker.ts`, `src/_lib/telemetryProxy.ts`).
Do not add a third-party script or host; the CSP in `src/securityHeaders.js`
allows none. PostHog is initialised once, in `src/instrumentation-client.ts`.
- Server events: `captureEvent(userId, name, props)`; exceptions:
  `captureServerException(error, { source, path, distinctId })`, both in
  `~/server/_lib/posthog`. Never pass an email address as an id, and never
  send request bodies, cookies or authorization headers.
- Consent: `~/_lib/consent`. "denied" (cookie or Global Privacy Control)
  means PostHog is never initialised and the proxy forwards nothing; replay
  and person properties need "granted".
- Every event is scrubbed of URL query strings, emails and codes before it
  is sent (`~/_lib/telemetryScrub`). Do not put personal data in event
  properties or in a URL path.

**Model output is untrusted.** `src/server/_lib/ai.ts` validates everything
Claude returns and the UI renders it as plain text. Keep it that way; never
use `dangerouslySetInnerHTML` with it. Generation happens after the response
and is stored (`src/server/_lib/matchInsights.ts`), never per page view.

**Member data can be exported and deleted.** A new model (or column) that
stores something about a member goes into the export's `EXPORT_COVERAGE`
and the deletion steps (`src/server/_lib/account/`, policy in
`docs/DATABASE.md`, "Account deletion"); the export test fails for a model
that is in neither. A deleted account is hidden by the soft-delete
extension (`User.isDeleted`). Anything that shows a member's photo or
writing carries `data-replay-block`. Analytics consent depends on region
(`consentRequiresOptIn` in `~/_lib/consent`).

**Rate limits** are policies in `src/server/_utils/rateLimit.ts`, applied
with `.use(rateLimit(RateLimits.X))` (`docs/RATE_LIMITING.md`).

## Conventions

- TypeScript strict; no `any`, no lint disables, no skipped tests.
- Imports from `src/` use `~/`. Files shared with the Worker entry
  (`src/_lib/telemetryProxy.ts`, `posthogServer.ts`, `jobToken.ts`,
  `src/worker/`, `src/do/`) use relative imports and Web APIs only; they are
  type-checked by `tsconfig.worker.json`.
- tRPC: `publicProcedure`, `protectedProcedure`, `proProcedure`,
  `founderProcedure` (`src/server/api/trpc.ts`); validate every input with
  Zod; throw `TRPCError` with the right code (client mistakes are not
  reported as errors, server faults are).
- Database access through `ctx.db` (Prisma with the soft-delete extension).
- Log with `logger` from `~/_utils`, never `console.log`. Do not log personal
  data; use `hashEmail` for an address.
- UI: Mantine components; server components by default, `"use client"` only
  where needed.

## Layout

```
worker.ts                 Worker entry (proxy, realtime, cron, then OpenNext)
src/worker/               Code that runs only in the Worker entry
src/do/                   ChatRoom Durable Object
src/app/                  Routes; src/app/api/** are route handlers
src/server/api/routers/   tRPC routers
src/server/_jobs/         Scheduled jobs (called through /api/internal/jobs/*)
src/server/_lib/          Email, AI, PostHog, background work, sign-up
src/server/_db/           Query helpers that need care on D1
src/_lib/                 Shared, dependency-light modules (site, consent, proxy)
docs/                     DATABASE.md, DEPLOYMENT.md, RATE_LIMITING.md, adr/
```
