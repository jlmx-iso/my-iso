import { logger, type LogMetadata } from "~/_utils";
import { captureServerException } from "~/server/_lib/posthog";

/**
 * Context keys that name or identify a person. They stay in the log line
 * but never go to error tracking, which must not tie a report to a member
 * (the report carries no user id, whatever the visitor's consent).
 */
const PERSONAL_KEY = /user|email|name|phone/i;

/** Context values simple enough to attach to an error report as they are. */
function scalarsOf(context: LogMetadata): Record<string, string | number | boolean | null> {
  const scalars: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(context)) {
    if (key === "error" || PERSONAL_KEY.test(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      scalars[key] = value;
    } else if (value === null) {
      scalars[key] = null;
    }
  }
  return scalars;
}

/**
 * Reports a billing problem a person should look at: a webhook that could
 * not be processed, a customer that cannot be mapped to a user, a missing
 * price id.
 *
 * The single place billing code reports through: it logs with the
 * structured logger and sends the problem to error tracking
 * (`captureServerException`, after the response). The report carries the
 * message, the original error when `context.error` holds one, and the
 * plain-valued fields of `context` (ids, event types); no user id is
 * attached, and email addresses and query strings are scrubbed on the way
 * out like for every event.
 */
export function reportBillingError(message: string, context: LogMetadata = {}): void {
  logger.error(message, { area: "billing", ...context });

  // Reporting must never be the thing that breaks a payment flow.
  try {
    const cause: unknown = context.error;
    const error = cause instanceof Error ? cause : new Error(message);
    captureServerException(error, {
      extra: { ...scalarsOf(context), message },
      source: "billing",
    });
  } catch (reportingError) {
    logger.warn("Could not report billing error", { area: "billing", error: reportingError });
  }
}
