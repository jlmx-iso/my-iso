# ADR 0001: Stay on OpenNext for launch; revisit vinext afterwards

- Status: accepted
- Date: 2026-11-12

## Context

ISO is a Next.js 16 app deployed to Cloudflare Workers. Today it is built by
`next build` and adapted to Workers by `@opennextjs/cloudflare`, behind a
custom Worker entry (`worker.ts`) that also hosts the `ChatRoom` Durable
Object.

[vinext](https://github.com/cloudflare/vinext) reimplements the Next.js API
surface on Vite and runs server code in workerd in development as well as in
production. Its appeal for this app is a much smaller Worker and one runtime
everywhere. Cloudflare limits a Worker to 10 MiB gzipped, and this app has
been close to it.

We ran a time-boxed spike on vinext 1.4.5 to find out whether to switch
before launch.

## What the spike found

The app did run under workerd on vinext, and the bundle was far smaller:

| | Worker bundle, gzipped |
| --- | --- |
| vinext 1.4.5 (spike) | 2.79 MiB |
| OpenNext at the time of the spike | about 8 MiB |
| OpenNext now | about 6.3 MiB |

Getting there took a few hours and three vinext bugs, each needing a
workaround in our code:

1. **Development mode failed on every page.** The browser received two
   copies of `@mantine/core` (one pre-bundled, one as raw ESM through RSC
   client references), so every page died with "MantineProvider was not
   found in component tree". Workaround: exclude all Mantine packages from
   Vite's `optimizeDeps` in the client, `rsc` and `ssr` environments, and
   re-include their CommonJS-only transitive dependencies by hand.
2. **`/_next/image` answered 400 in development.**
3. **next-auth broke on requests the Worker makes to itself.** The Worker
   entry asks `/api/auth/session` who the caller is before opening a
   WebSocket. vinext's route-handler request proxy threw "Illegal
   invocation" when next-auth cloned such a request, unless the incoming
   request's `cf` object was forwarded on the synthesised one.

Further costs that are not bugs but are ours to carry:

- **Prisma needed an alias.** The generated client lists the `node` export
  condition before `workerd`; the Workers environment resolves with both, so
  the Node build (which compiles its WASM at runtime, forbidden in workerd)
  won. The spike aliased `.prisma/client/default` and `#main-entry-point` to
  the edge build. The durable fix is Prisma's `prisma-client` generator with
  `runtime = "workerd"`.
- **Configuration moves.** `wrangler.toml` is replaced by a
  `cloudflare.config.ts`, every server-side variable has to be declared as a
  binding (OpenNext populated them from the environment), the database
  client is rewritten around `cloudflare:workers`, and local development no
  longer has a Node/SQLite mode.
- **Client error-tracking injection did not work** under the Vite build.
- **The default setup depends on beta packages**: `cf` (1.0.0-beta) for
  configuration and `@cloudflare/vite-plugin` (2.0.0-beta).
- **Maturity.** 322 open issues six weeks after 1.0.
- **No way back once deployed.** Deploying from vinext changes how the
  `ChatRoom` Durable Object is declared. Cloudflare does not roll back
  across a Durable Object migration, so production could not simply return
  to the OpenNext build if something went wrong.

## Decision

Stay on OpenNext for launch.

The one hard reason to move, the bundle limit, is no longer pressing: the
OpenNext bundle is about 6.3 MiB, and CI fails any build over 9.5 MiB
(`npm run check:bundle`), so a regression is caught long before a deploy
fails. Against that, switching now means shipping on a framework that needed
three workarounds in an afternoon, on beta tooling, with no rollback for
the stateful part of the system, right before launch.

## Consequences

- We keep `next build` + OpenNext, `wrangler.toml`, and the Node/SQLite
  development mode (`npm run dev`) next to the real runtime
  (`npm run dev:wrangler`).
- We keep watching the bundle size through the CI budget.
- Code that would make a later move harder is kept contained: runtime
  detection and the D1 binding live in `src/server/db.ts`, access to the
  Cloudflare context in `src/server/_lib/background.ts` and
  `src/server/_lib/realtime.ts`.

## Revisit after launch

Pilot vinext on a **separate staging Worker** with its own Durable Object
namespace and D1 database, so that nothing about the existing deployments
changes and abandoning the pilot costs nothing. Go further only if:

- development mode works without per-dependency `optimizeDeps` lists;
- the `next-auth` and `/_next/image` problems are fixed upstream;
- the default setup no longer needs beta packages;
- browser error tracking (PostHog exception capture and source maps) works
  with the Vite build;
- there is a rehearsed plan for the Durable Object, including what a
  rollback looks like.
