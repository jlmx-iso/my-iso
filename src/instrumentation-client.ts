// Runs in the browser before any other application code (a Next.js
// convention), so it is the one place for set-up that must precede it.
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

// Zod 4 compiles object schemas with `new Function` when it can, and finds
// out by trying `new Function("")`. The Content-Security-Policy forbids
// that (no 'unsafe-eval'), so the probe is a reported violation on every
// page that validates a form. `jitless` makes Zod skip the probe and use its
// interpreter, which is all the browser needs. Server code is unaffected.
z.config({ jitless: true });

// Sentry's router instrumentation hooks in here. Without a DSN (local runs,
// CI, previews) the client is never started and this does nothing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
