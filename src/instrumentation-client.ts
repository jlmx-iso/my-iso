// Next.js loads this file in the browser before the app hydrates (the
// `instrumentation-client` convention). It starts browser telemetry, unless
// the visitor has refused it: see ~/_lib/analyticsBrowser.

import { startAnalytics } from "~/_lib/analyticsBrowser";

startAnalytics();
