/**
 * Rules for a member's handle, the last segment of their public profile URL
 * (`/photographer/<handle>`): lowercase letters, digits and underscores,
 * 3 to 30 characters, and not a reserved word. This is the single definition:
 * the server's `handleInput` (src/server/_utils/handle.ts) is built from it
 * and the forms validate with it before sending.
 */
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;
export const HANDLE_CHARACTERS = /^[a-z0-9_]+$/;
export const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

/**
 * Handles appear in URLs (/photographer/<handle>), so the names of routes
 * and of roles someone could impersonate are not available.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "about",
  "account",
  "admin",
  "administrator",
  "api",
  "app",
  "auth",
  "billing",
  "contact",
  "dashboard",
  "discover",
  "events",
  "help",
  "home",
  "invite",
  "invites",
  "iso",
  "join",
  "login",
  "logout",
  "me",
  "messages",
  "moderator",
  "myiso",
  "new",
  "null",
  "official",
  "onboarding",
  "photographer",
  "photographers",
  "pricing",
  "privacy",
  "register",
  "root",
  "search",
  "security",
  "settings",
  "signin",
  "signup",
  "staff",
  "support",
  "system",
  "team",
  "terms",
  "undefined",
  "verify",
  "waitlist",
  "webhooks",
  "www",
]);

/**
 * What people tend to type: one leading "@", capitals, stray spaces. The
 * one normalisation, used by the forms and by the server's `handleInput`.
 * Only ONE "@" is dropped: "@@ann" keeps an "@" and is refused as invalid
 * characters, rather than quietly becoming "ann".
 */
export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@/, "").toLowerCase();
}

export type HandleProblem = "too_short" | "too_long" | "invalid_characters" | "reserved";

/**
 * What is wrong with an already-normalised handle (lowercase, no "@"), or
 * null when it is acceptable. Whether it is already taken is only known to
 * the database.
 */
export function handleProblem(handle: string): HandleProblem | null {
  if (handle.length < HANDLE_MIN_LENGTH) return "too_short";
  if (handle.length > HANDLE_MAX_LENGTH) return "too_long";
  if (!HANDLE_CHARACTERS.test(handle)) return "invalid_characters";
  if (RESERVED_HANDLES.has(handle)) return "reserved";
  return null;
}

/** Shown under the username field for each way a handle can be refused. */
export const HANDLE_MESSAGES: Record<HandleProblem | "refused" | "taken", string> = {
  invalid_characters: "Use only lowercase letters, numbers and underscores (no spaces, dots or dashes)",
  /** The server refused it and the rules above do not say why. */
  refused: "That username can't be used. Choose a different one.",
  reserved: "That username is reserved. Choose a different one.",
  taken: "That username is taken. Try another one.",
  too_long: `Use at most ${HANDLE_MAX_LENGTH} characters`,
  too_short: `Use at least ${HANDLE_MIN_LENGTH} characters`,
};

/**
 * Validation message for a handle as typed, or null when it is acceptable.
 * An empty handle is acceptable: the field is optional.
 */
export function validateHandle(input: string): string | null {
  const handle = normalizeHandle(input);
  if (handle === "") return null;
  const problem = handleProblem(handle);
  return problem ? HANDLE_MESSAGES[problem] : null;
}

/**
 * Message for a handle the server refused: taken (CONFLICT), or failing its
 * validation. Null when the failure has nothing to do with the handle.
 */
export function refusedHandleMessage(
  handle: string,
  failure: { code: string | undefined; invalidFields: readonly string[] },
): string | null {
  if (failure.code === "CONFLICT") return HANDLE_MESSAGES.taken;
  if (!failure.invalidFields.includes("handle")) return null;
  return validateHandle(handle) ?? HANDLE_MESSAGES.refused;
}

/** Public profile URL for a handle, exactly as the route matches it (no "@"). */
export function publicProfileUrl(baseUrl: string, handle: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/photographer/${normalizeHandle(handle)}`;
}

/**
 * Where the "is this username free?" check stands while it is being typed:
 *
 * - `idle`: nothing to check (empty, or it breaks the rules: the field
 *   already says how).
 * - `checking`: waiting for the typing to pause, or for the server.
 * - `available` / `taken`: the server's answer for exactly what is typed.
 * - `unknown`: the check failed; saving will still catch a taken handle.
 */
export type HandleAvailability = "idle" | "checking" | "available" | "taken" | "unknown";

export function handleAvailability({
  handle,
  checkedHandle,
  result,
  isFetching,
  isError,
}: {
  /** The normalised handle as typed now. */
  handle: string;
  /** The (debounced) handle the latest answer is for. */
  checkedHandle: string;
  result: { available: boolean } | undefined;
  isFetching: boolean;
  isError: boolean;
}): HandleAvailability {
  if (handle === "" || handleProblem(handle) !== null) return "idle";
  // Still typing: the answer on hand is for an earlier spelling.
  if (handle !== checkedHandle) return "checking";
  if (isError) return "unknown";
  if (isFetching || !result) return "checking";
  return result.available ? "available" : "taken";
}
