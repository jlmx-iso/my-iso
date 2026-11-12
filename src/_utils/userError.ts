/**
 * Turns an error from a tRPC call, `fetch` or `signIn` into copy that is safe
 * and useful to show to a user. Every message the UI shows for a failed
 * request goes through `userFacingError`.
 *
 * Server messages are only passed through when the server deliberately wrote
 * them for the user (a client-error code and a short, plain sentence). Zod
 * validation dumps, internal errors and transport failures get friendly copy.
 * Errors with a machine-readable reason (see ErrorReason) and rate limits
 * (whose message says how long to wait) are recognised first.
 */
import { ErrorReason, getErrorReason } from "./errorReason";

export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";
export const NETWORK_ERROR_MESSAGE =
  "We couldn't reach ISO. Check your connection and try again.";
export const RATE_LIMIT_MESSAGE =
  "Too many attempts. Please wait a moment and try again.";
export const SESSION_EXPIRED_MESSAGE =
  "Your session has expired. Please sign in again.";
export const NOT_MESSAGEABLE_MESSAGE =
  "You can't message this person yet. Match with them on Discover or apply to one of their events to connect.";
export const NEW_CONVERSATION_LIMIT_MESSAGE =
  "You've reached today's limit for starting new conversations. You can still reply in your existing ones, and start new ones tomorrow.";
export const PORTFOLIO_FULL_MESSAGE =
  "Your portfolio is full. Remove an image to add another.";

/**
 * Copy for the reasons whose wording is the client's to choose. The server's
 * own sentence is only a fallback for these: what the person can do next
 * depends on the screen they are on.
 */
export const REASON_MESSAGES: Partial<Record<ErrorReason, string>> = {
  [ErrorReason.BILLING_UNAVAILABLE]:
    "Billing isn't available right now. You haven't been charged. Please try again in a few minutes.",
  [ErrorReason.BOOKING_EVENT_FILLED]:
    "This event already has its second shooter, so another application can't be accepted.",
  [ErrorReason.BOOKING_EVENT_STARTED]:
    "This event has already started, so the booking can't be changed this way anymore.",
  [ErrorReason.BOOKING_INVALID_TRANSITION]:
    "This booking changed while you had it open, so nothing was done. Its card shows where it stands now.",
  [ErrorReason.BOOKING_NOT_ALLOWED]: "Only the other person in this booking can do that.",
  [ErrorReason.BOOKING_NOT_YET_COMPLETABLE]:
    "You can mark this booking as completed once the event is over.",
  [ErrorReason.NO_BILLING_ACCOUNT]:
    "You don't have a subscription to manage yet. You can start one from this page.",
  [ErrorReason.SUBSCRIPTION_EXISTS]:
    "You already have a subscription. You can manage it in the billing portal.",
};

/** tRPC codes whose messages are written for the user. */
const USER_FACING_CODES = new Set([
  "BAD_REQUEST",
  "CONFLICT",
  "FORBIDDEN",
  "NOT_FOUND",
  "PAYLOAD_TOO_LARGE",
  "PRECONDITION_FAILED",
  "TOO_MANY_REQUESTS",
  "UNPROCESSABLE_CONTENT",
]);

const NETWORK_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_network|err_internet/i;

type ErrorData = { code?: unknown; httpStatus?: unknown; zodError?: unknown };

function readData(error: unknown): ErrorData | undefined {
  if (typeof error !== "object" || error === null || !("data" in error)) return undefined;
  const { data } = error;
  return typeof data === "object" && data !== null ? (data) : undefined;
}

function readMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    return typeof error.message === "string" ? error.message : "";
  }
  return "";
}

/** A short plain sentence, not JSON, a stack trace or a database error. */
function isPlainSentence(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  if (/^[[{]/.test(trimmed)) return false;
  if (trimmed.includes("\n")) return false;
  return !/prisma|sqlite|d1_|invalid `|unexpected token|at \w+ \(|undefined|null\b/i.test(trimmed);
}

/**
 * Messages Zod writes by itself ("Too big: expected string to have <=2000
 * characters", "Invalid input: expected string, received undefined"). They
 * describe the schema, not what the person should do, so they are never shown.
 */
const ZOD_DEFAULT_MESSAGE = /^(invalid|too (small|big)|required|unrecognized|expected)\b/i;

function isWrittenForUsers(message: unknown): message is string {
  return typeof message === "string" && isPlainSentence(message) && !ZOD_DEFAULT_MESSAGE.test(message.trim());
}

/** Messages of a Zod issue array that was serialised into an error message. */
function issueMessages(message: string): string[] {
  if (!message.trim().startsWith("[")) return [];
  try {
    const issues: unknown = JSON.parse(message);
    if (!Array.isArray(issues)) return [];
    return issues.flatMap((issue: unknown) =>
      typeof issue === "object" && issue !== null && "message" in issue && typeof issue.message === "string"
        ? [issue.message]
        : [],
    );
  } catch {
    return [];
  }
}

/**
 * The first validation message of a failed call that the server wrote for
 * the user (for example "Image is too large (maximum 5 MB)."), or null when
 * there is none or only Zod's own wording.
 */
function validationMessage(error: unknown): string | null {
  const candidates: unknown[] = [];
  const zodError = readData(error)?.zodError;
  if (typeof zodError === "object" && zodError !== null) {
    if ("fieldErrors" in zodError && typeof zodError.fieldErrors === "object" && zodError.fieldErrors !== null) {
      for (const messages of Object.values(zodError.fieldErrors)) {
        if (Array.isArray(messages)) candidates.push(...(messages as unknown[]));
      }
    }
    if ("formErrors" in zodError && Array.isArray(zodError.formErrors)) {
      candidates.push(...(zodError.formErrors as unknown[]));
    }
  }
  candidates.push(...issueMessages(readMessage(error)));
  return candidates.find(isWrittenForUsers) ?? null;
}

/** True for a Zod validation failure, however it reached the client. */
function isValidationError(error: unknown): boolean {
  return !!readData(error)?.zodError || issueMessages(readMessage(error)).length > 0;
}

/** True when the server refused the request for being over a rate limit. */
export function isRateLimited(error: unknown): boolean {
  return readData(error)?.code === "TOO_MANY_REQUESTS";
}

/**
 * True for errors that asking again cannot fix: the request itself was
 * refused (not signed in, not allowed, invalid, not found, rate limited).
 * Network failures and server errors are not client errors.
 */
export function isClientError(error: unknown): boolean {
  const status = readData(error)?.httpStatus;
  return typeof status === "number" && status >= 400 && status < 500;
}

/** The tRPC error code of a failed call ("CONFLICT", "FORBIDDEN", ...), if it has one. */
export function trpcErrorCode(error: unknown): string | undefined {
  const code = readData(error)?.code;
  return typeof code === "string" ? code : undefined;
}

export function isNetworkError(error: unknown): boolean {
  if (readData(error)) return false;
  if (error instanceof TypeError) return true;
  return NETWORK_PATTERN.test(readMessage(error));
}

/** Names of the input fields a tRPC Zod error complains about. */
export function zodErrorFields(error: unknown): string[] {
  const zodError = readData(error)?.zodError;
  if (typeof zodError !== "object" || zodError === null || !("fieldErrors" in zodError)) return [];
  const { fieldErrors } = zodError;
  return typeof fieldErrors === "object" && fieldErrors !== null ? Object.keys(fieldErrors) : [];
}

/**
 * First validation message per input field from a tRPC Zod error, for showing
 * next to the field it belongs to. Empty when the error is not a validation
 * error.
 */
export function zodFieldErrors(error: unknown): Record<string, string> {
  const zodError = readData(error)?.zodError;
  if (typeof zodError !== "object" || zodError === null || !("fieldErrors" in zodError)) return {};
  const { fieldErrors } = zodError;
  if (typeof fieldErrors !== "object" || fieldErrors === null) return {};

  const result: Record<string, string> = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    const [first] = Array.isArray(messages) ? (messages as unknown[]) : [];
    if (isWrittenForUsers(first)) result[field] = first;
  }
  return result;
}

export function userFacingError(
  error: unknown,
  fallback: string = GENERIC_ERROR_MESSAGE,
): string {
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE;

  const data = readData(error);
  const code = typeof data?.code === "string" ? data.code : undefined;
  const message = readMessage(error);

  if (code === "UNAUTHORIZED") return SESSION_EXPIRED_MESSAGE;
  if (isValidationError(error)) return validationMessage(error) ?? fallback;

  switch (getErrorReason(error)) {
    case ErrorReason.RECIPIENT_NOT_MESSAGEABLE:
      return NOT_MESSAGEABLE_MESSAGE;
    case ErrorReason.NEW_CONVERSATION_LIMIT:
      // The server's sentence names the daily number.
      return isPlainSentence(message) ? message : NEW_CONVERSATION_LIMIT_MESSAGE;
    case ErrorReason.PORTFOLIO_FULL:
      return isPlainSentence(message) ? message : PORTFOLIO_FULL_MESSAGE;
    default:
      break;
  }
  const reason = getErrorReason(error);
  const reasonMessage = reason ? REASON_MESSAGES[reason] : undefined;
  if (reasonMessage) return reasonMessage;
  if (code === "TOO_MANY_REQUESTS") {
    return isPlainSentence(message) ? message : RATE_LIMIT_MESSAGE;
  }
  if (code && USER_FACING_CODES.has(code) && isPlainSentence(message)) return message;

  return fallback;
}
