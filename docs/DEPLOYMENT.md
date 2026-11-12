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

1. checks that the database is not one created before the migration
   baseline (it stops and names the one-time upgrade command if it is);
2. builds the Worker for that environment (and uploads source maps, if
   configured);
3. checks the bundle (`npm run check:bundle`);
4. applies pending D1 migrations;
5. deploys the Worker.

Migrations go first because they are written to be safe for the code that is
already deployed, while new code may not work without them
([DATABASE.md](DATABASE.md)). GitHub Actions CI never deploys.

### Production deploys from `main`: Workers Builds

The repository is connected to the `my-iso` Worker through Cloudflare
Workers Builds, so every push to `main` deploys production. Its settings
(Workers & Pages → `my-iso` → Settings → Build) must be:

| Setting | Value | Why |
| --- | --- | --- |
| Build command | *(empty)* | Workers Builds installs dependencies itself (`npm clean-install`) before the build command; a build command of `npm run build` fails, because a plain `next build` validates runtime secrets that do not exist at build time. The deploy command builds. |
| Deploy command | `npm run deploy:production` | The default, `npx wrangler deploy`, skips the database check and the migrations above: new code would go live against a database that lacks its tables. |
| Build variables | The build-time values below (`NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_STRIPE_PUBLIC_KEY`, `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY`, `NEXT_PUBLIC_POSTHOG_PUBLIC_KEY`, …) | On Workers Builds (`WORKERS_CI=1`) the deploy script reads them from the build environment instead of `.env.deploy.production`. A missing one stops the deploy before anything changes. |
| API token | One with **Workers Scripts: Edit** and **D1: Edit** on the account | The script queries the database and applies migrations with it. Without D1 access the deploy stops at step 1. |
| Preview builds (non-production branches) | Off, until staging is wired | A preview version uses the production bindings, including the production database. |
| Node.js version | *(nothing to set)*; do **not** set `NODE_VERSION` | The build image reads `.nvmrc` (`26`) and installs that release; it only preinstalls 22 and 24, and its default is 24. A `NODE_VERSION` build variable would override `.nvmrc`; if one is set from earlier, delete it or set it to `26`. |
| npm version | *(nothing to set)* | Taken from `packageManager` in `package.json` (`npm@11.20.0`), the only way the build image changes npm. npm 11.20 runs a dependency's install scripts only when `allowScripts` in `package.json` lists it: Prisma's engines, workerd, esbuild, better-sqlite3 and the PostHog CLI are listed. A dependency that newly needs its install script must be added there (`npm install-scripts approve <pkg>`), or the build fails in odd ways. The entries are by name, not pinned to a version: a routine bump of workerd or Prisma needs no edit, at the cost that a new version of a listed package runs its new install script unreviewed (the lockfile, which the test-bar guard keeps on the npm registry, is what pins it). `core-js` and `fsevents` are denied: their scripts are not needed. `engines.npm` (`>=11.20.0`) says which npm understands `allowScripts`; an older npm ignores the field and runs every script. |

Staging is deployed by hand with `npm run deploy:staging`.

A failed deploy changes nothing: the previous version keeps serving. In
particular, while the database still predates the baseline, every deploy
from `main` stops at step 1 and names `npm run db:upgrade-legacy`.

**Plan.** The app assumes the **Workers Paid** plan: the bundle is over the
Free plan's size limit, and the billing code is sized for the Paid plan's
subrequest and `waitUntil` limits. The figures and what depends on them are
in [BILLING.md](BILLING.md), "Platform limits this is sized for"; this is
the only place this document relies on it.

## Configuration

There are three places a value can live. Which one is decided by when it is
read, not by how secret it is.

### 1. Build-time values: `.env.deploy.<environment>`

`NEXT_PUBLIC_*` values are inlined into the JavaScript when the app is built.
Staging and production therefore need **separate builds**, which the deploy
script does. Create `.env.deploy.staging` and `.env.deploy.production` from
[`.env.deploy.example`](../.env.deploy.example) (both are gitignored). On
Workers Builds the same values are set as Build variables instead.

| Variable | What it is for | Where to get it |
| --- | --- | --- |
| `NEXT_PUBLIC_BASE_URL` | The deployment's public origin. The single source of truth for absolute URLs (metadata, sitemap, emails, Stripe return URLs, the WebSocket origin in the CSP). Profile and event views are counted only on this host, so the apex/www redirect must send visitors here ([DATABASE.md](DATABASE.md), "View counters"). | Your domain, e.g. `https://myiso.app` |
| `NEXT_PUBLIC_APP_ENV` | Tags browser analytics with `production` / `staging`. | Set by the deploy script; do not put it in the file |
| `NEXT_PUBLIC_STRIPE_PUBLIC_KEY` | Stripe.js in the browser. | Stripe > Developers > API keys (publishable key) |
| `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` | Location autocomplete in the browser. | Google Cloud > Credentials; restrict it to the origin |
| `NEXT_PUBLIC_POSTHOG_PUBLIC_KEY` | PostHog project token. Empty = PostHog off. | PostHog > Project settings (starts with `phc_`) |
| `NEXT_PUBLIC_POSTHOG_UI_HOST` | Optional. PostHog app host for EU projects. | `https://eu.posthog.com` |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Optional. Address shown to people who need help (the contact page, the legal pages, the support page for members without Pro). | Your choice; defaults to `support@myiso.app` |
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
| `SUPPORT_INBOX_EMAIL` | Optional. Where Pro members' in-app support requests are sent (Settings > Support, or Help & support in the account menu), through Resend, with `[Pro]` at the start of the subject so the inbox can filter and prioritise them. The email carries the member's id, not their address: look them up by id to reply. Defaults to `NEXT_PUBLIC_SUPPORT_EMAIL`, then `support@myiso.app`. Needs `RESEND_API_KEY`. | An inbox the team reads |
| `STRIPE_STANDARD_MONTHLY_PRICE_ID`, `STRIPE_STANDARD_ANNUAL_PRICE_ID`, `STRIPE_FOUNDING_MONTHLY_PRICE_ID`, `STRIPE_FOUNDING_ANNUAL_PRICE_ID` | The prices checkout offers. | Stripe > Products (ids start with `price_`) |
| `CSP_MODE` | Optional. The Content-Security-Policy kill switch: `enforce` (the default) blocks what the policy does not allow; `report-only` blocks nothing and only reports. Violations are reported in both modes (`csp_violation` events). See "Content-Security-Policy" below. | Leave unset; `report-only` only to stop the policy breaking pages |
| `ANTHROPIC_MODEL` | Optional. Overrides the Claude model (`claude-haiku-5-5`). Only the models listed in `src/aiModels.js` are accepted: the requests turn thinking off, which Claude Sonnet 5.5, Claude Opus 5.5 and the Fable models refuse. | `src/aiModels.js` |

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

Never set on a deployment:

- `DATABASE_URL`: the Worker uses the D1 binding.
- `ANTHROPIC_BASE_URL`: points the Anthropic SDK at a local stub.
- `STRIPE_API_BASE_URL`: sends every Stripe API call to a local stand-in
  (the stub in `src/test/helpers/stripeStub.ts`, or `stripe-mock`) instead
  of Stripe, for tests and for trying billing locally
  ([BILLING.md](BILLING.md), "Testing locally with the stub"). It must be
  unset in staging and production. The app accepts only a loopback address
  and, in a production deployment (a live-mode key, or a
  `NEXT_PUBLIC_BASE_URL` that is not this machine), refuses to build a
  Stripe client at all while it is set (`src/server/_billing/stripe.ts`):
  it cannot redirect real payments, but leaving it set breaks billing.

The app validates all of this when the Worker starts (`src/env.js`). With a
required value missing, requests fail and `wrangler tail` shows
`Invalid environment variables` with the names; `/api/health` is the quick
check.

## Source maps

Source maps are uploaded by the deploy scripts and only by them, for exactly
the files being deployed. When `.env.deploy.<environment>` has
`POSTHOG_CLI_API_KEY` and `POSTHOG_CLI_PROJECT_ID`, `scripts/deploy.mjs`
sets `SOURCEMAPS=upload`: the build generates browser source maps,
`scripts/sourcemaps.mjs` writes a chunk id into each JavaScript file, uploads
the maps to PostHog error tracking and deletes them from the assets. Without
the two variables no source maps are generated.

The personal API key needs the scopes *error tracking: write* and
*organization: read*. `POSTHOG_CLI_HOST` defaults to `https://us.posthog.com`.

CI never uploads and holds no PostHog credentials. It builds with
`SOURCEMAPS=dry-run`, which generates the maps, runs the PostHog CLI over
them in its dry-run mode (no network), and checks that none is left in the
assets. In every mode the build fails if a `.map` file would be deployed.

Stack traces of server-side errors are not source-mapped.

## What is sent to PostHog, and what never is

- **Only through this origin.** The browser sends telemetry to `/lens/*`;
  the Worker forwards it. The proxy forwards only the SDK's own requests
  (event capture, session replay, the SDK's script files and remote config),
  never cookies, an `Authorization` header or the `Referer` (the page URL,
  query string included), and answers 404 for anything else.
- **Scrubbed.** Before an event leaves, in the browser and on the server,
  every string in it loses URL query strings and fragments, email addresses
  and invite codes; error messages and stack frames also lose standalone
  six-figure sign-in codes (`src/_lib/telemetryScrub.ts`). The waitlist link
  (`/join?...&email=`) and invite links (`/join?code=`) are the reason.
- **Identity.** A signed-in member is identified by user id, never by email.
  Email and name are attached only with explicit consent.
- **Consent** (`src/_lib/consent.ts`): one cookie, `iso_consent`, plus the
  browser's Global Privacy Control signal, which always counts as a refusal.
  - *denied*: PostHog is not initialised in the browser, the proxy answers
    204 without contacting PostHog, and no server-side product event is
    sent. The one exception is operational: an exception on the server is
    still reported, anonymously, with no user id, nothing derived from the
    visitor, no IP address and no query string.
  - *unknown* (until a banner asks): product analytics and error reports,
    attributed to a signed-in member by user id (pseudonymous: no email or
    name), anonymous otherwise. No session replay, no person properties,
    and nothing stored in the browser: PostHog keeps its state in memory,
    so an anonymous id lasts one page load.
  - *granted*: all of the above plus session replay, person properties and
    PostHog's cookie and localStorage. Granting mid-session moves the
    running SDK's state into storage; withdrawing it moves it back.
- **Server errors** name the signed-in user only from the authenticated
  session (decrypted with `AUTH_SECRET`), never from a cookie the browser
  controls. Database errors carry no query arguments: Prisma runs with
  `errorFormat: "minimal"` outside development, and validation errors, which
  reprint the query whatever the format, are reduced to the call and the
  problem before they are reported.

### Session replay

Whether replay records is a PostHog project setting; the app additionally
requires *granted* consent. When it records (`src/_lib/analyticsBrowser.ts`):

- everything typed into any input is masked;
- **all text on every page is masked** (`maskTextSelector: "*"`), so
  messages, names, email addresses and phone numbers cannot appear;
- any element with the attribute `data-replay-block` is replaced by an empty
  box. Text masking does not hide pictures, so these must carry it before
  replay is switched on: avatars, portfolio and profile photos, image
  attachments in messages, and uploaded-image previews.

To make recordings readable later, add `data-private` to every element that
shows personal content (message bubbles, thread list previews and titles,
member names, email addresses, phone numbers, bios, locations, review text,
booking notes) and change `maskTextSelector` from `"*"` to
`REPLAY_PRIVATE_TEXT_SELECTOR`. Until every one of them is marked, keep `"*"`.

### Rate limiting the proxy

`/lens/*` is unauthenticated by nature. The app's own limiter costs a
database write per check, which telemetry must not, so limit it at the edge:
Cloudflare dashboard > Security > WAF > Rate limiting rules, one rule per
zone:

- *If* URI Path starts with `/lens/`
- *Characteristics*: IP address
- *Rate*: 300 requests per minute (posthog-js batches; a real browser sends a
  handful per minute)
- *Action*: Block for 1 minute

## First deploy checklist

Do staging completely, then production.

1. **Cloudflare.** `wrangler login`. The D1 database ids in `wrangler.toml`
   must belong to your account; if they do not, create the databases
   (`wrangler d1 create my-iso-db-staging`, `wrangler d1 create my-iso-db`)
   and put the ids in `wrangler.toml`.
2. **Database.** A new database is created by the first deploy's migration
   step. The existing staging and production databases predate
   `migrations/0001_init.sql`: run `npm run db:upgrade-legacy -- --env staging`
   (then `--yes`) once before the first deploy to staging, and the same for
   production after staging has been checked
   ([DATABASE.md](DATABASE.md), "Upgrading a database created before the
   baseline"). The deploy stops with this command if it is forgotten.
3. **Custom domain.** Uncomment `routes` in `wrangler.toml` (both
   environments) once the zone is on the account. Do this before launch: on
   a `workers.dev` address content blockers defeat the telemetry proxy.
4. **Google OAuth.** In the OAuth client, add the redirect URI
   `https://<domain>/api/auth/callback/google` and the JavaScript origin
   `https://<domain>` for each environment.
5. **Resend.** Verify the sending domain (DNS records), then use an address
   on it for `EMAIL_FROM`.
6. **Stripe.** Follow "Stripe dashboard setup" in [BILLING.md](BILLING.md):
   the product and its four prices, the webhook endpoint
   `https://<domain>/webhooks/stripe` with its pinned API version and the
   event types to subscribe it to (listed there, under "Events handled",
   and nowhere else), the customer portal and the retry settings. Copy the
   endpoint's signing secret. Use test mode keys for staging. A database
   that held subscriptions before this release also needs the one-time
   re-sync described there.
7. **Edge rate limit.** Add the WAF rate limiting rule for `/lens/`
   described under "Rate limiting the proxy".
8. **PostHog.** Create a project (one per environment, or one project and
   filter on the `environment` property). Session replay and its sampling
   are project settings; the app only records for visitors who have
   explicitly consented and masks all text and inputs ("Session replay").
   Leave replay off in the project until the elements listed there carry
   `data-replay-block`.
9. **Variables and secrets.** Fill the two `[vars]` blocks, run
   `wrangler secret put` for every secret, create `.env.deploy.<environment>`.
10. **Deploy.** `npm run deploy:staging`.
11. **Check.**
    - `curl https://<domain>/api/health` returns `"status":"ok"`, the right
      `environment`, and the same value under `build.environment`.
    - Telemetry proxy: `curl -i https://<domain>/lens/array/<phc_token>/config.js`
      returns 200 and JavaScript; in the browser's network panel every
      request goes to your own domain, and events appear in PostHog.
    - Sign in with Google and with an emailed code.
    - Stripe: send a test event from the webhook page; it must return 200.
    - Cron: `wrangler tail --env staging` shows `Scheduled job finished`
      lines within 15 minutes.
12. Repeat for production.

## Scheduled jobs

`[triggers]` in `wrangler.toml` runs the jobs in `src/server/_jobs` (mapping
in `src/worker/scheduled.ts`):

| Cron (UTC) | Jobs |
| --- | --- |
| `*/15 * * * *` | `expire-matches` |
| `17 3 * * *` | `purge-expired`, `reconcile-invites` |

Each logs a `Scheduled job finished` summary and reports failures to PostHog
error tracking.

The billing tables need no job. `StripeEvent` (webhook de-duplication, kept
30 days) and `BillingLease` are purged by the billing code itself, on a
small share of the writes to each (`purgeOldStripeEvents` in
`src/server/_billing/eventLog.ts`, `purgeExpiredLeases` in
`src/server/_billing/lease.ts`); `purge-expired` deliberately leaves them
alone. An expired lease or claim is never honoured, purged or not.
`SubscriptionDispute` is not housekeeping data: it is the record of the
disputes known for a subscription, which the payment standing is derived
from, and is never purged. Rows whose subscription state was never read
from Stripe are brought up to date by the re-sync script and the lazy first
sync ([BILLING.md](BILLING.md)), not by a scheduled job.

To run the jobs locally: `npx wrangler dev --test-scheduled`, then
`npm run jobs:local`.

## Content-Security-Policy

Every page is served with an enforced `Content-Security-Policy` carrying a
fresh nonce (`src/middleware.ts`, `src/securityHeaders.js`; why it is built
this way: [adr/0002-csp.md](adr/0002-csp.md)). Browsers report violations to
`/api/csp-report`, which forwards the ones that matter to PostHog as
`csp_violation` events. They reach PostHog only when
`NEXT_PUBLIC_POSTHOG_PUBLIC_KEY` is set: without it the endpoint accepts
reports and discards them, and nothing else records them. Set the token
before relying on this section to investigate violations.

If a release makes the policy block something the app needs, switch it to
report-only without a deploy, then fix the policy. In the Cloudflare
dashboard: Workers & Pages → `my-iso` (or `my-iso-staging`) → Settings →
Variables and Secrets. If `CSP_MODE` is already listed, edit its value to
`report-only`; otherwise add it as a plain-text variable with that value.
Use the dashboard rather than `wrangler secret put`: a variable that already
exists as plain text cannot be overwritten as a secret
(`Binding name 'CSP_MODE' already in use`). Nothing here is secret, so a
plain-text variable is right.

The dashboard value lasts only until the next deploy: `wrangler.toml` does
not set `keep_vars`, so every deploy replaces the Worker's plain-text
variables with its `[vars]`, which leave `CSP_MODE` unset (enforce). To keep
report-only across deploys while the policy is being fixed, add
`CSP_MODE = "report-only"` to that environment's `[vars]` in the same change.

Changing a variable or secret makes Cloudflare roll out a new Worker version,
which serves requests within seconds; no code deploy is needed. Delete the
variable (or set it to `enforce`) to enforce the policy again. The value is
trimmed and lower-cased; anything other than `report-only` enforces, so a
typo can't turn the policy off or stop the Worker from starting.

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
