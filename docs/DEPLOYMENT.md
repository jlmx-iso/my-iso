# Deployment

ISO runs as one Cloudflare Worker per environment:

| Environment | Worker | D1 database | wrangler flag |
| --- | --- | --- | --- |
| production | `my-iso` | `my-iso-db` | `--env=""` (the top level of `wrangler.toml`) |
| staging | `my-iso-staging` | `my-iso-db-staging` | `--env staging` |

```sh
npm run deploy:staging
npm run deploy:production
```

Each command (`scripts/deploy.mjs`) does, in this order, and stops at the
first failure:

1. builds the Worker for that environment (and uploads source maps, if
   configured);
2. checks the bundle (`npm run check:bundle`);
3. applies pending D1 migrations;
4. deploys the Worker.

Migrations go first because they are written to be safe for the code that is
already deployed, while new code may not work without them
([DATABASE.md](DATABASE.md)). CI never deploys.

## Configuration

There are three places a value can live. Which one is decided by when it is
read, not by how secret it is.

### 1. Build-time values: `.env.deploy.<environment>`

`NEXT_PUBLIC_*` values are inlined into the JavaScript when the app is built.
Staging and production therefore need **separate builds**, which the deploy
script does. Create `.env.deploy.staging` and `.env.deploy.production` from
[`.env.deploy.example`](../.env.deploy.example) (both are gitignored).

| Variable | What it is for | Where to get it |
| --- | --- | --- |
| `NEXT_PUBLIC_BASE_URL` | The deployment's public origin. The single source of truth for absolute URLs (metadata, sitemap, emails, Stripe return URLs, the WebSocket origin in the CSP). | Your domain, e.g. `https://myiso.app` |
| `NEXT_PUBLIC_APP_ENV` | Tags browser analytics with `production` / `staging`. | Set by the deploy script; do not put it in the file |
| `NEXT_PUBLIC_STRIPE_PUBLIC_KEY` | Stripe.js in the browser. | Stripe > Developers > API keys (publishable key) |
| `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` | Location autocomplete in the browser. | Google Cloud > Credentials; restrict it to the origin |
| `NEXT_PUBLIC_POSTHOG_PUBLIC_KEY` | PostHog project token. Empty = PostHog off. | PostHog > Project settings (starts with `phc_`) |
| `NEXT_PUBLIC_POSTHOG_UI_HOST` | Optional. PostHog app host for EU projects. | `https://eu.posthog.com` |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Optional. Address shown to people who need help. | Your choice; defaults to `support@myiso.app` |
| `POSTHOG_CLI_API_KEY`, `POSTHOG_CLI_PROJECT_ID`, `POSTHOG_CLI_HOST` | Optional. Source map upload, see below. Not part of the app. | PostHog > Personal API keys; Project settings |

OpenNext copies the contents of `.env`, `.env.local` and `.env.production`
into the Worker bundle as fallback values. The deploy script does not use
those files and warns if they exist: keep secrets out of them on a machine
that deploys.

### 2. Runtime variables: `wrangler.toml` `[vars]`

Not secret, read when the Worker runs, different per environment.

| Variable | What it is for | Value |
| --- | --- | --- |
| `NODE_ENV` | Always `production` on Cloudflare. | set |
| `APP_ENV` | Names the deployment: tags server analytics and errors, reported by `/api/health`. | `production` / `staging`, set |
| `POSTHOG_HOST`, `POSTHOG_ASSETS_HOST` | Where the telemetry proxy and server events go. | US Cloud, set; change both for EU |

Add these to both `[vars]` blocks when you have the values (they are not
secret, but they are yours to choose):

| Variable | What it is for | Where to get it |
| --- | --- | --- |
| `AUTH_URL` | Auth.js's idea of the app's origin; must equal `NEXT_PUBLIC_BASE_URL`. | Your domain |
| `EMAIL_FROM` | Sender of every transactional email. | An address on the domain verified in Resend |
| `STRIPE_STANDARD_MONTHLY_PRICE_ID`, `STRIPE_STANDARD_ANNUAL_PRICE_ID`, `STRIPE_FOUNDING_MONTHLY_PRICE_ID`, `STRIPE_FOUNDING_ANNUAL_PRICE_ID` | The prices checkout offers. | Stripe > Products (ids start with `price_`) |
| `ANTHROPIC_MODEL` | Optional. Overrides the Claude model (`claude-haiku-5-5`). | Anthropic model ids |

### 3. Secrets: `wrangler secret put`

```sh
wrangler secret put AUTH_SECRET --env staging
wrangler secret put AUTH_SECRET --env=""        # production
```

| Secret | What it is for | Where to get it |
| --- | --- | --- |
| `AUTH_SECRET` | Signs session tokens; also keys the hashes used for rate limiting and the internal job endpoint. Different per environment; at least 32 characters. Changing it signs everyone out. | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in. | Google Cloud > Credentials > OAuth client |
| `GOOGLE_PLACES_API_KEY` | Server-side Places lookups. | Google Cloud > Credentials |
| `RESEND_API_KEY` | Sending email. Without it no email is sent, including sign-in codes. | Resend > API keys |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Image uploads. | Cloudinary > Settings > API keys |
| `STRIPE_SECRET_KEY` | Stripe API. | Stripe > Developers > API keys |
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe webhooks. | Stripe > Webhooks > the endpoint's signing secret |
| `ANTHROPIC_API_KEY` | Optional. Match summaries and icebreakers; without it they are off. | Anthropic Console |

`DATABASE_URL` is not used on Cloudflare (the Worker uses the D1 binding) and
`ANTHROPIC_BASE_URL` is for local stubs only.

The app validates all of this when the Worker starts (`src/env.js`). With a
required value missing, requests fail and `wrangler tail` shows
`Invalid environment variables` with the names; `/api/health` is the quick
check.

## Source maps

With `POSTHOG_CLI_API_KEY` and `POSTHOG_CLI_PROJECT_ID` set, the build
generates browser source maps, `scripts/sourcemaps.mjs` uploads them to
PostHog error tracking, and they are deleted from the assets before deploy.
Without the two variables no source maps are generated at all. In both cases
the script fails the build if a `.map` file would be deployed.

The personal API key needs the scopes *error tracking: write* and
*organization: read*. `POSTHOG_CLI_HOST` defaults to `https://us.posthog.com`.

The upload has to happen on the build that is deployed, because the upload
step also writes a chunk id into each JavaScript file. That is why it is part
of `npm run deploy:*`. CI has the same step, fed by the repository secrets
`POSTHOG_CLI_API_KEY` and `POSTHOG_CLI_PROJECT_ID` (and the optional variable
`POSTHOG_CLI_HOST`) on pushes to `main`; it skips cleanly when they are not
set. CI builds with placeholder configuration and does not deploy, so its
upload only exercises the pipeline.

Stack traces of server-side errors are not source-mapped.

## First deploy checklist

Do staging completely, then production.

1. **Cloudflare.** `wrangler login`. The D1 database ids in `wrangler.toml`
   must belong to your account; if they do not, create the databases
   (`wrangler d1 create my-iso-db-staging`, `wrangler d1 create my-iso-db`)
   and put the ids in `wrangler.toml`.
2. **Database.** A new database is created by the first deploy's migration
   step. A database that existed before `migrations/0001_init.sql` needs the
   one-time upgrade in [DATABASE.md](DATABASE.md) first.
3. **Custom domain.** Uncomment `routes` in `wrangler.toml` (both
   environments) once the zone is on the account. Do this before launch: on
   a `workers.dev` address content blockers defeat the telemetry proxy.
4. **Google OAuth.** In the OAuth client, add the redirect URI
   `https://<domain>/api/auth/callback/google` and the JavaScript origin
   `https://<domain>` for each environment.
5. **Resend.** Verify the sending domain (DNS records), then use an address
   on it for `EMAIL_FROM`.
6. **Stripe.** Create the products and prices. Add a webhook endpoint
   `https://<domain>/webhooks/stripe` and copy its signing secret. Use test
   mode keys for staging.
7. **PostHog.** Create a project (one per environment, or one project and
   filter on the `environment` property). Session replay and its sampling
   are project settings; the app only records for visitors who have
   explicitly consented and always masks inputs.
8. **Variables and secrets.** Fill the two `[vars]` blocks, run
   `wrangler secret put` for every secret, create `.env.deploy.<environment>`.
9. **Deploy.** `npm run deploy:staging`.
10. **Check.**
    - `curl https://<domain>/api/health` returns `"status":"ok"`, the right
      `environment`, and the same value under `build.environment`.
    - Telemetry proxy: `curl -i https://<domain>/lens/array/<phc_token>/config.js`
      returns 200 and JavaScript; in the browser's network panel every
      request goes to your own domain, and events appear in PostHog.
    - Sign in with Google and with an emailed code.
    - Stripe: send a test event from the webhook page; it must return 200.
    - Cron: `wrangler tail --env staging` shows `Scheduled job finished`
      lines within 15 minutes.
11. Repeat for production.

## Scheduled jobs

`[triggers]` in `wrangler.toml` runs the jobs in `src/server/_jobs` (mapping
in `src/worker/scheduled.ts`):

| Cron (UTC) | Jobs |
| --- | --- |
| `*/15 * * * *` | `expire-matches` |
| `17 3 * * *` | `purge-expired`, `reconcile-invites` |

Each logs a `Scheduled job finished` summary and reports failures to PostHog
error tracking. Locally: `npx wrangler dev --test-scheduled`, then
`npm run jobs:local`.

## Rollback

Code:

```sh
wrangler deployments list --env staging     # find the version to return to
wrangler rollback --env staging             # or: wrangler rollback <version-id> --env staging
# production: the same commands with --env=""
```

A rollback restores the previous Worker, including the build-time values it
was built with. It does not touch:

- **The database.** Migrations are not reversed. They are additive, so the
  previous code keeps working against the newer schema; that is the reason
  for the rule in [DATABASE.md](DATABASE.md). If a migration itself is the
  problem, fix it with a new migration.
- **Secrets and variables changed since.** Set them back by hand.
- **Durable Object migrations.** Cloudflare refuses to roll back past a
  deployment that changed the Durable Object classes.

After a rollback, check `/api/health`: `commit` tells you which build is
live.
