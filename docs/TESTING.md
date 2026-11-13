# Testing

Most of this codebase is written by agents. The test suite is what stops a
change from quietly breaking something else, so the bar is high and
enforced by CI, and it only moves up.

## The bar

| Check | Rule | Where | Blocks a merge |
| --- | --- | --- | --- |
| Coverage, global | lines 80%, branches 74%, functions 76%, statements 80% of everything under `src/` (see scope below) | `coverage-thresholds.json` | yes |
| Coverage, critical code | higher per-directory floors (lines / branches / functions / statements): `src/server/_billing` 96 / 91 / 95 / 94, `src/server/_db` 96 / 91 / 100 / 95, `src/server/api/routers` 90 / 82 / 95 / 90, `src/server/_jobs` 100 / 96 / 100 / 98, `src/_lib` 99 / 95 / 98 / 99, `src/app/api` 100 / 96 / 100 / 99, `src/auth.ts` 100 / 93 / 100 / 100 | `coverage-thresholds.json` | yes |
| Diff coverage | at least **90%** of the executable lines a pull request adds or edits under `src/` (tests excluded) are run by the suite | `scripts/diff-coverage.mjs` | yes |
| Coverage guard | no threshold lowered or removed, no file measured before left unmeasured, against the base branch, unless the pull request has the **`coverage-exception`** label | `scripts/coverage-guard.mjs` | yes |
| Test bar guard | a pull request that changes a test-bar file (thresholds, coverage scope, the checks, workflows) needs the **`coverage-exception`** label; raising thresholds does not | `.github/workflows/test-bar-guard.yml` | yes, once required |
| Strict DOM tests | a DOM test fails on a tRPC call it gave no handler for, and on any `console.error` it did not allow | `src/test/dom/strict.ts` | yes |
| Authorization matrix | **every tRPC procedure has a row** saying who may call it, and behaves as its row says | `src/server/api/authz.matrix.test.ts` | yes |
| Mutation score | reported weekly, for a few critical modules | `stryker.config.mjs` | no |

The global numbers were measured with the UI rework (PR #36), client
route files in scope, and rendered tests for the top client components;
the JSON file is the source of truth.

### Rules for every change (agents included)

1. **Every pull request adds tests for what it changes.** Diff coverage
   enforces the minimum (90% of changed lines run); the review checks that
   the tests assert the behaviour, not just execute it.
2. **A bug fix starts with a failing test.** Write the test that reproduces
   the bug, see it fail, then fix the code. The test stays.
3. **A new tRPC procedure gets a row in the authorization matrix** in the
   same pull request. The test fails until it has one. Choosing `public`, or
   moving a procedure to a weaker level, is a security decision: say why in
   the pull request.
4. **Never lower a threshold or add an exclusion.** If coverage rose,
   ratchet it (below). If a change cannot keep a threshold, it needs more
   tests, not a lower bar. CI's coverage guard enforces this; the rare
   deliberate exception (a measurement change, say) needs the
   `coverage-exception` label on the pull request and the reason in its
   description.
5. Test through the real thing where the suite already can: the database
   layer runs against real SQLite (`src/test/helpers/sqlite.ts`), billing
   against the real Stripe SDK talking to a local stub
   (`src/test/helpers/stripeStub.ts`), components through the DOM.

## Running the suites

| Command | What |
| --- | --- |
| `npm test` | Vitest, all unit, integration and DOM tests (about 90 s) |
| `npm run test:watch` | the same, watching |
| `npm run test:coverage` | the same with coverage; fails under any threshold. Writes `coverage/` (HTML in `coverage/index.html`, `lcov.info`, `coverage-summary.json`) |
| `npm run coverage:diff` | diff coverage of this branch against `origin/main`, after `test:coverage` (`-- --base main --threshold 90` to change either) |
| `npm run coverage:ratchet` | raise the thresholds to the measured coverage, after `test:coverage` |
| `npm run coverage:guard` | compare thresholds and exclusions with `origin/main` (`-- --base <ref>`); fails if either got weaker |
| `npm run test:mutation` | Stryker over the files in `stryker.config.mjs` (tens of minutes; `-- --mutate src/_lib/telemetryScrub.ts` for one file). Report in `reports/mutation/index.html` |
| `npm run test:e2e` | Playwright against the built Worker in workerd with a local D1, after `npm run build:cf` (see "End-to-end" below) |

One file or test: `npx vitest run src/server/_billing/entitlements.test.ts`,
`npx vitest run -t "retries a failed call"`.

## Coverage

### Scope

Coverage counts every source file under `src/` (`.ts`, `.tsx`, `.js`,
`.jsx`, `.mjs`, `.cjs`), including files no test imports, which count as 0%.
What is measured is defined once, in `coverage.config.mjs`, which Vitest,
the diff-coverage script and the coverage guard all read (a test checks
that `vitest.config.ts` takes it from there). It lists what is left out and
why, each with a comment:

- tests and test helpers (`*.test.*`, `src/test/`);
- type-only files (`*.d.ts`, `src/types/`, `src/_types/`) and styles;
- Next.js route-convention files (`page.tsx`, `layout.tsx`, `error.tsx`,
  ...) **that are server components**: async components that need the
  Next.js request scope, covered by the build and the E2E smoke. The list is
  computed from the files without a `"use client"` directive; a client
  route file is measured like any component. Keep logic out of server route
  files: put it in a module or component that is measured. Route handlers
  (`route.ts`) are in scope;
- `src/instrumentation-client.ts`, `src/middleware.ts`: framework bootstrap;
- `src/server/db.ts`: chooses the database driver at import time; tests
  inject their own SQLite client;
- `src/do/ChatRoom.ts`: imports `cloudflare:workers`, which exists only in
  workerd. Its logic is in `chatRoomPolicy.ts` and `realtimeGateway.ts`;
- `src/server/_lib/emails/`: React Email templates (static markup).

Add to this list only for code that cannot run under Vitest, with the
reason next to it. The coverage guard fails a pull request that adds an
exclusion (or changes the route-file rule) without the `coverage-exception`
label. `.github/CODEOWNERS` asks the owner to review changes to these files.

### Thresholds and the ratchet

`coverage-thresholds.json` holds the global thresholds and the
per-directory ones (Vitest `coverage.thresholds`, glob keys). They were set
to the measured values rounded down. `npm run test:coverage` fails if any is
missed.

When a change raises coverage, run:

```sh
npm run test:coverage
npm run coverage:ratchet      # rewrites coverage-thresholds.json, upward only
```

and commit `coverage-thresholds.json` with the change. The script raises
each threshold to the new measured value rounded down and never lowers one;
`npm run coverage:ratchet -- --check` reports what it would change and
exits 1, without writing. Do this whenever you add tests; there is no need
to ratchet on every pull request, but the bar should never sit far below the
measurement.

Coverage must be the same on every run, or the gate fails at random. Code
that does something only by chance (a 1% cleanup, say) takes the random
function as a parameter, and a test drives both branches (see
`src/server/_billing/eventLog.test.ts`).

### Diff coverage

On pull requests CI runs, after the coverage run:

```sh
npm run coverage:diff -- --base origin/<base branch> --threshold 90
```

It takes `git diff --unified=0 <base>...HEAD -- src/` (the changes since the
branch left its base), keeps the added or edited lines of non-test files,
and looks each up in `coverage/lcov.info`. Lines the coverage report does
not count as executable (comments, types, imports, blank lines) do not
count. It prints each file's covered/total and the uncovered line numbers,
warns about changed files under `src/` that `coverage.config.mjs` excludes
or does not include, writes the same to the job summary, and fails under
90%. A change with no executable lines in `src/` passes. It fails closed: a
coverage report with no file under `src/`, or a changed file coverage should
measure but has no record of, is a failure. It runs git with
`core.quotePath=false` and decodes the paths git still quotes (quotes,
backslashes, control characters), octal escapes and literal non-ASCII
characters alike.

### Coverage guard

Also on pull requests, `node scripts/coverage-guard.mjs --base origin/<base
branch>` compares `coverage-thresholds.json` and `coverage.config.mjs` with
the base branch's copies and fails if

- a threshold is lower or gone (a whole directory entry included);
- an include pattern was removed, an exclusion glob added, or the
  route-file rule changed;
- **any file under `src/` that the base's rules measure is not measured by
  the head's**. Both copies of `coverage.config.mjs` (the base's taken from
  git) are evaluated against the same tree, so a change in how exclusions
  are computed (say, `isClientModule`) is caught by its effect, whatever
  the code looks like;
- the base has no `coverage-thresholds.json` or `coverage.config.mjs`.
  `--bootstrap` skips this, and CI passes it only while the base branch
  predates the guard (the pull request that introduces it).

With the **`coverage-exception`** label on the pull request (CI re-runs when
labels change) it reports the same and passes. Use the label only for a
deliberate change of what is measured, and say why in the pull request.

A test (`scripts/coverage-config.test.ts`) checks that Vitest's resolved
coverage options are exactly `coverage.config.mjs` and
`coverage-thresholds.json`, nothing added in `vitest.config.ts`. CI calls the
coverage run, diff coverage and the guard directly (`npx vitest run
--coverage`, `node scripts/...`), not through `package.json` scripts, so
editing a script cannot switch a gate off.

### Test bar guard (workflow)

A pull request could still edit its own `ci.yml` or the guard script. A
second workflow, `.github/workflows/test-bar-guard.yml`, runs on
`pull_request_target`: GitHub runs the **default branch's** copy of it, so
a pull request cannot change or remove it. It never checks out or runs the
pull request's code: it reads the list of changed files from the API and
fails if any is part of the test bar (`scripts/test-bar-paths.mjs`, the
same list as `.github/CODEOWNERS`: thresholds, `coverage.config.mjs`,
`vitest.config.ts`, `package.json`, the coverage scripts, `stryker.config.mjs`,
the strict DOM setup, the authorization matrix, `trpc.ts`, workflows,
CODEOWNERS), unless the pull request has the `coverage-exception` label.
The job summary lists the files and says the label is required. A change
to `coverage-thresholds.json` that only raises numbers (a ratchet) passes
without the label; it compares the two JSON texts read through the API.

`package.json` is guarded field by field, from its two JSON texts read the
same way. A change that only touches dependency versions passes without the
label: `dependencies`, `devDependencies`, `optionalDependencies`,
`peerDependencies`, `overrides`, `engines` (node and npm only) and
`packageManager` (an exact `npm@x.y.z`), each version a registry range by
node-semver's grammar (`^1.2.3`, `>=26 <27`, `1.0.0-beta.2`, `1 - 2`; in
`overrides` also `$name`). Anything else needs the label:

- a change to `scripts`, or to a field outside that list (`imports` or
  `type` can redirect what a test runs; `allowScripts` decides which
  dependency code runs at install);
- a version that is an alias (`npm:`), a URL, a git or GitHub reference, a
  path or a dist-tag (`latest`, `5next`);
- any change to a **measurement package** (`MEASUREMENT_PACKAGES` in the
  script): vitest, `@vitest/*`, vite, `@stryker-mutator/*`,
  `@playwright/test`, `playwright*`, happy-dom, `@testing-library/*`,
  `istanbul-*`, v8-to-istanbul, ast-v8-to-istanbul, `@bcoe/v8-coverage`,
  test-exclude and magicast. Added, removed, upgraded or downgraded in any
  dependency field, or named as an override key at any depth (a transitive
  coverage library pinned through `overrides` counts).

`package-lock.json` is checked the same way, from its two texts: a lockfile
change passes without the label only if

- every package it installs resolves to exactly the registry's tarball for
  its own name and version,
  `https://registry.npmjs.org/<name>/-/<basename>-<version>.tgz` (the name
  from the entry's `name` field, else its folder; the basename without the
  scope). So no other host, git, file or link, and no other version's or
  other package's tarball behind the right version number;
- no measurement package changed, appeared or went anywhere in the tree:
  name, version, tarball and integrity hash are compared together, by path
  and by the package installed (an alias of one counts).

`.npmrc` (registry, scripts and install settings) and `.nvmrc` (the Node
version that runs the tests and coverage) always need the label.

**Known limit.** Coverage also depends on packages that are not on the
measurement list: glob, minimatch, @jridgewell/trace-mapping, tinypool,
chai, esbuild, rollup and others. A lockfile bump of those passes the
guard without the label, as any dependency bump does. The list is kept to
the tools that measure; code-owner review of `package-lock.json` is what
covers the rest.

All three files are also in CODEOWNERS. Owners cannot be set per field or
per package, and a dependency bump is worth the owner's eyes anyway, so
`package.json` and `package-lock.json` are listed whole: the guard decides
whether the **label** is needed, code-owner review is required for every
change to them. The guard runs the base branch's copy, so a change to
these rules takes effect once it has merged.

It takes effect once it is on the default branch (so not for the pull
request that adds it). Make "Test bar guard" a **required status check** in
branch protection, alongside requiring code-owner review.

## Authorization matrix

`src/server/api/authz.matrix.test.ts` holds one table, `POLICY`, with a row
per procedure: its access level and a minimal valid input.

| access | anonymous | member | Pro member | founder / ambassador |
| --- | --- | --- | --- | --- |
| `public` | allowed | allowed | allowed | allowed |
| `member` (`protectedProcedure`) | UNAUTHORIZED | allowed | allowed | allowed |
| `pro` (`proProcedure`) | UNAUTHORIZED | FORBIDDEN | allowed | FORBIDDEN without a subscription (roles do not grant Pro) |
| `admin` (`founderProcedure`) | UNAUTHORIZED | FORBIDDEN | FORBIDDEN | allowed |

A gate's refusal is recognised by its cause, `AccessGateError` (set by the
gates in `trpc.ts`), never by its code or message, so a resolver's own
UNAUTHORIZED cannot pass for the gate. Probe procedures exercise each gate.

**Pro-only procedures must use `proProcedure`** and have `access: "pro"`
(today `insights.getSummary` and `support.contact`). A Pro check written
inside a resolver is caught: a `member` row must answer a member without
Pro the same way it answers a Pro member, so a resolver that refuses one
and not the other fails the row, `resolverDenies` or not (a probe proves
it). Because every row carries a valid input, the check runs past input
validation. A settled Pro subscription for a test user of your own:
`makePro` (`src/test/helpers/pro.ts`).

The test walks `appRouter._def.procedures`, so a new procedure without a row
fails ("missing"), and so does a row for a procedure that no longer exists
("stale"). Each procedure is called as each of the five callers against a
real SQLite database with outbound network disabled. "Allowed" means the
call got past the gate in `src/server/api/trpc.ts`: it may still fail on its
own terms (NOT_FOUND for the made-up ids), but not with a gate's error and
not on input validation. When a resolver itself answers UNAUTHORIZED or
FORBIDDEN for the minimal input (an object-level check such as "not a
participant of this thread"), the row says so in `resolverDenies`.

## DOM tests

Vitest runs in Node. A test file that renders components opts into a DOM
with a docblock on its first line, and is named `*.dom.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders, trpcError } from "~/test/dom/render";

vi.mock("next-auth/react", () => import("~/test/dom/session"));
import { testSession } from "~/test/dom/session";

it("...", async () => {
  testSession.signIn("user-1");
  const view = renderWithProviders(<Thing />, {
    trpc: {
      thing: {
        get: () => ({ id: "t1" }),
        save: () => {
          throw trpcError("FORBIDDEN", "Not yours");
        },
      },
    },
  });
  await userEvent.click(await screen.findByRole("button", { name: "Save" }));
  expect(view.callsTo("thing.save")).toEqual([{ id: "t1" }]);
});
```

`renderWithProviders` wraps the component in `MantineProvider` and the real
`@trpc/react-query` client (`api` from `~/trpc/react`) whose one link answers
from the handlers you give it, typed per procedure. Queries, mutations and
their `onError`/`onSuccess` run as in the app; only the network is replaced.
`view.calls` and `view.callsTo(path)` record what was sent. React Query does
not retry in tests.

DOM tests are strict (`src/test/dom/strict.ts`): a test fails if the
component called a procedure the test gave no handler for (even if the
component swallowed the error), or if anything was logged with
`console.error` (act() warnings, React errors, and the app's own
`logger.error`). Where an error log is the expected outcome of the test,
allow exactly that one: `allowConsoleError(/Error updating booking/)`
(exported from `~/test/dom/render`; several patterns in one call are
fine). A pattern is required, and one that matches any message (an empty
pattern, `/./`, `/.*/`, `/[\s\S]*/`) is refused.

Test through the DOM: roles, labels and text a user sees. Do not add test
hooks to components. For time, use fake timers limited to what the code
uses (`vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })`)
and advance them inside `act` (see `MessageFeed.dom.test.tsx`,
`BookingCard.dom.test.tsx`).

## Mutation testing

`npm run test:mutation` runs [Stryker](https://stryker-mutator.io/) over the
modules listed in `stryker.config.mjs` (entitlements, booking transitions,
the rate limiter, telemetry scrubbing). For each small change it makes to
the code, it runs the related tests; a change no test notices "survives".
The HTML report (`reports/mutation/index.html`) shows each survivor in
place.

Baseline (all four files, 580 mutants, about 12 minutes on 4 cores): 97%.

| File | Score | Survivors left, and why they are accepted |
| --- | --- | --- |
| `telemetryScrub.ts` | 100% | none |
| `entitlements.ts` | 100% | none |
| `bookingTransitions.ts` | 95% | equivalent: `when: "any_time"` emptied (behaves the same), `ownerNotes: undefined` written (Prisma ignores it), the accept condition's `id: { not: bookingId }` (the booking itself never holds the slot), and the chunking of `withDerivedFulfilled` (same result, different queries) |
| `rateLimit.ts` | 94% | log messages and metadata, the hash namespace string (not observable), and the test-only clock restore |

The first run found real gaps (83% and 96% for the first two, 92% and 84%
for the others): sign-in codes in thrown non-Error values, nested
`email`/`name` keys outside `$set`, query strings on `http://` and `ws://`
URLs, a row with no invoices read as refunded, sign-in limit keys, the
limiter's failure answer, and the booking slot rules. Each now has a test
(none needed an app change). Keep the table up to date when a run changes
it, and give every new survivor that matters a test.

It runs weekly and on demand (`.github/workflows/mutation.yml`, Actions tab,
"Run workflow"), uploads the report as the `mutation-report` artifact and
puts the score in the job summary. It is not a required check. Read the
survivors: one that changes behaviour that matters (who gets access, what is
redacted, when a limit trips) is a missing test; equivalent mutants (a
change with no observable effect) can be ignored.

## End-to-end

```sh
NEXT_PUBLIC_BASE_URL=http://localhost:8788 npm run build:cf   # with the usual build variables
npm run test:e2e
```

`npm run test:e2e` runs Playwright (`e2e/`, `playwright.config.ts`) against
the built Worker. Its web server, `e2e/serve.mjs`, applies `migrations/` and
`prisma/seed-staging.sql` to a fresh local D1 in `e2e/.state`, then starts
`wrangler dev` on port 8788 with placeholder runtime variables passed as
`--var`. Your keys are never used: it passes `--env-file e2e/empty.env`,
which makes wrangler skip `.dev.vars` and `.env`, and
`CLOUDFLARE_INCLUDE_PROCESS_ENV=false`, so the shell's environment is not
copied in either. The tests cover the landing page,
the sign-in page, the redirect of an anonymous visitor, and a signed-in
member (the seeded Sarah Chen) loading the events feed and creating an
event. The session is the encrypted JWT Auth.js would set after a sign-in,
minted in the test with the server's placeholder `AUTH_SECRET` and set as a
cookie.

`e2e/signin.spec.ts` drives a real Google sign-in instead: `serve.mjs` also
starts a local OpenID provider on port 8789 (`src/test/helpers/oidcStub.ts`:
discovery, a consent page, token with PKCE, a signed ID token, userinfo,
JWKS) and points the Worker at it with `GOOGLE_OAUTH_ISSUER_URL`, a
test-only variable accepted for loopback addresses only and refused in a
production deployment (`src/auth.config.ts`). The spec clicks "Sign in with
Google" on `/login`, completes the consent and checks where it lands: an
invitee signed in on `/app` with its `User` and token-free `Account` rows
(read from the local D1 file), an address without an invite on `/join`,
and an account being deleted (a fixture `serve.mjs` writes) back on `/login`
with the deletion message. The same provider runs in Vitest
(`src/auth.signin.test.ts`), where the Auth.js handler runs with the app's
configuration against SQLite. About 30 seconds after the build.

Chromium: Playwright's own (`npx playwright install chromium`), or one
already on the machine at `/opt/pw-browsers/chromium` or `E2E_CHROMIUM_PATH`.
Traces are off. CI runs this as the "End-to-end smoke" job, in parallel with
the others.

No real outbound calls. The browser may only reach the Worker under test
(and, in the sign-in spec, the local OpenID provider, which `isolate()`
accepts only on a loopback address): any other host is refused, and a test
that tried one fails, naming it. The
one Worker call a test could trigger, Google Places autocomplete (typing a
location), is refused in the browser before it reaches the Worker, so the
form's fallback (it keeps the typed text) is what runs. The rest is off by
configuration in `e2e/serve.mjs`: no Resend or Anthropic key, Stripe never
called by these pages, PostHog pointed at a closed local port, and
`WRANGLER_SEND_METRICS=false`. `wrangler dev` has no option to block the
Worker's own outbound requests, so a new test that makes the Worker call
out must keep it from doing so the same way. A server already started with
`node e2e/serve.mjs` is reused locally (never in CI). CI caches Playwright's
Chromium per Playwright version.
