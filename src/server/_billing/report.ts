import { logger, type LogMetadata } from "~/_utils";

/**
 * Reports a billing problem a person should look at: a webhook that could
 * not be processed, a customer that cannot be mapped to a user, a missing
 * price id.
 *
 * ERROR-TRACKING SEAM: this is the single place billing code reports
 * through. It logs with the structured logger today; when the app's
 * error-capture helper lands, call it here (and nowhere else in _billing).
 */
export function reportBillingError(message: string, context: LogMetadata = {}): void {
  logger.error(message, { area: "billing", ...context });
}
