// The CSP_MODE environment variable, parsed so that it can never fail:
// surrounding whitespace and letter case are ignored, an unset value is the
// default, and any other value falls back to enforcing. Environment
// validation throws at module load, so a strict enum would turn a typo in
// the kill switch into an outage of every page (docs/adr/0002-csp.md).

import { z } from "zod";

import { CSP_MODES, DEFAULT_CSP_MODE } from "./securityHeaders.js";

export const cspModeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.enum(CSP_MODES).catch(DEFAULT_CSP_MODE),
);
