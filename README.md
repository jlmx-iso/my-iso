# ISO

ISO is an invite-only network where lead photographers find second shooters.
The app's domain is `myiso.app`; it is operated by MyISO, LLC
(<https://myiso.dev>).

## Stack

| | |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, Mantine 9, tRPC 11 |
| Runtime | Cloudflare Workers through [OpenNext](https://opennext.js.org/cloudflare), with a custom entry (`worker.ts`) |
| Database | Cloudflare D1 (SQLite) with Prisma 7; plain SQLite locally and in tests |
| Realtime | A Durable Object per message thread (`src/do/ChatRoom.ts`) |
| Auth | Auth.js v5: Google sign-in and emailed one-time codes; sign-up needs an invite |
| Analytics, replay, flags, errors | PostHog, through a first-party proxy on the app's own origin |
| Email | Resend |
| Images | Cloudinary |
| Payments | Stripe |
| AI | Claude (match summaries and icebreakers), optional |

Package manager: npm. Node 22 (`.nvmrc`).

## Run it locally

```sh
npm ci
cp .env.example .env        # fill in what you need; see docs/DEPLOYMENT.md
npm run db:push             # creates the SQLite file `next dev` uses
npm run db:seed             # optional demo data
npm run dev                 # http://localhost:3000
```

`npm run dev` is plain `next dev` on Node with a SQLite file. To run the real
thing, the built Worker on workerd with a local D1 (set
`NEXT_PUBLIC_BASE_URL` and `AUTH_URL` to `http://localhost:8787` for this):

```sh
cp .dev.vars.example .dev.vars
npm run db:migrate:local    # applies migrations/ to the local D1
npm run db:seed:local       # optional demo data
npm run dev:wrangler        # builds, then `wrangler dev` on http://localhost:8787
```

Variables without a value switch their feature off where that is possible:
no `NEXT_PUBLIC_POSTHOG_PUBLIC_KEY` means no analytics, no `RESEND_API_KEY`
means no email is sent, no `ANTHROPIC_API_KEY` means no AI text.

## Check your work

```sh
npm run lint
npm run typecheck           # the app, then worker.ts against the Workers types
npm test                    # Vitest; database tests run against real SQLite
npm run db:check            # migrations/ and prisma/schema.prisma agree
npm run build:cf            # Next.js build + OpenNext Worker
npm run check:bundle        # wrangler dry run; fails over 9.5 MiB gzipped
```

CI (`.github/workflows/ci.yml`) runs all of these on every pull request and
never deploys. Tests run with coverage (`npm run test:coverage`) and must
meet the thresholds, cover 90% of the lines a pull request changes, and keep
the authorization matrix complete. The bar, the other suites (DOM,
end-to-end, mutation) and the rules for changes are in
[docs/TESTING.md](docs/TESTING.md).

## Database changes

Edit `prisma/schema.prisma`, run `npm run db:migrate:diff`, save the SQL as
the next file in `migrations/`. Details and rules in
[docs/DATABASE.md](docs/DATABASE.md).

## Scheduled jobs

Cron Triggers in `wrangler.toml` run small idempotent jobs from
`src/server/_jobs` (expire stale matches, purge expired rows, reconcile
invite counters). To run them against a local Worker:

```sh
npx wrangler dev --test-scheduled      # after npm run build:cf
npm run jobs:local                     # in another terminal
```

## Deploy

```sh
npm run deploy:staging
npm run deploy:production
```

Each builds for that environment, applies pending D1 migrations, then deploys.
Everything about configuration, secrets, first deploy and rollback is in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Where things are

```
worker.ts                 Worker entry: telemetry proxy, realtime gateway, cron, then Next.js
wrangler.toml             Cloudflare config (top level = production, [env.staging])
migrations/               D1 migrations (the schema that is actually applied)
prisma/schema.prisma      The schema you edit
src/app/                  Pages, layouts and route handlers
src/server/api/routers/   tRPC routers
src/server/_jobs/         Scheduled jobs
src/server/_lib/          Email, AI, PostHog, background work
src/do/                   ChatRoom Durable Object and its gateway
src/env.js                Every environment variable, validated
docs/                     BILLING, DATABASE, DEPLOYMENT, RATE_LIMITING, adr/
```
