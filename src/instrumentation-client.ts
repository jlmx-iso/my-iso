// Next.js loads this file in the browser before the app hydrates (the
// `instrumentation-client` convention), so it is the one place for set-up
// that must precede every other module.
import { z } from "zod";

import { startAnalytics } from "~/_lib/analyticsBrowser";

// Zod 4 compiles object schemas with `new Function` when it can, and finds
// out by trying `new Function("")`. The Content-Security-Policy forbids
// that (no 'unsafe-eval'), so the probe is a reported violation on every
// page that validates a form. `jitless` makes Zod skip the probe and use its
// interpreter, which is all the browser needs. Server code is unaffected.
// Schemas are only parsed after this module has run: nothing imported above
// parses one at import time (analyticsBrowser reads `process.env` directly).
z.config({ jitless: true });

// Browser telemetry, unless the visitor has refused it: see
// ~/_lib/analyticsBrowser.
startAnalytics();
