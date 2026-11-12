// What must never reach PostHog, removed before an event leaves: in the
// browser (`before_send` in src/instrumentation-client.ts) and on the server
// (`before_send` in ./posthogServer).
//
// Why: URLs in this app carry personal data and credentials. The waitlist
// approval email links to `/join?waitlist=approved&email=<address>`, invite
// links are `/join?code=<invite code>`, and error messages can quote either,
// or a sign-in code. PostHog's SDK records URLs in many properties
// (`$current_url`, `$referrer`, `$initial_*`, `$session_entry_*`,
// `$prev_pageview_*`, `$external_click_url`, autocapture `attr__href` and
// `$elements_chain`, exception stack frames, ...), and that list changes with
// SDK versions. So nothing here depends on property names: every string in an
// event is scrubbed by content.
//
// No imports on purpose: the browser entry, server code and the Worker use it.

const EMAIL = /[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** ISO-<HANDLE>-<8 characters>, see src/server/_utils/invite.ts. */
const INVITE_CODE = /\bISO-[A-Za-z0-9]{3,5}-[A-Za-z0-9]{8}\b/gi;
/**
 * A sign-in code: exactly six digits standing alone. Not part of a path,
 * file name, version or id (those would break stack-frame file names).
 */
const OTP = /(?<![\w./-])\d{6}(?![\w-]|\.\w)/g;
/** An absolute URL's query string and fragment. */
const ABSOLUTE_URL_TAIL = /((?:https?|wss?):\/\/[^\s"'<>()?#]+)[?#][^\s"'<>()]*/gi;
/** The same for a path that starts at the root ("/join?code=..."). */
const RELATIVE_URL_TAIL = /((?:^|[\s"'=(])\/[^\s"'<>()?#]*)[?#][^\s"'<>()]*/g;

export const REDACTED_EMAIL = "[email]";
export const REDACTED_INVITE_CODE = "[invite-code]";
export const REDACTED_CODE = "[code]";

/** `url` without its query string and fragment. Not a URL: returned as is. */
export function stripUrlQuery(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

/**
 * Removes, from any text: the query string and fragment of every URL in it,
 * email addresses and invite codes. With `codes`, also standalone six-digit
 * numbers (sign-in codes); that is only applied to error text, where a
 * six-digit number is never data we need.
 */
export function scrubText(text: string, options: { codes?: boolean } = {}): string {
  let result = text
    .replace(ABSOLUTE_URL_TAIL, "$1")
    .replace(RELATIVE_URL_TAIL, "$1")
    .replace(EMAIL, REDACTED_EMAIL)
    .replace(INVITE_CODE, REDACTED_INVITE_CODE);
  if (options.codes) result = result.replace(OTP, REDACTED_CODE);
  return result;
}

/** Deep enough for exception lists and autocapture elements; then it stops. */
const MAX_DEPTH = 8;

function scrubValue(value: unknown, codes: boolean, depth: number): unknown {
  if (typeof value === "string") return scrubText(value, { codes });
  if (depth >= MAX_DEPTH || typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, codes, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = scrubValue(item, codes, depth + 1);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Person properties set on purpose, with consent (see ~/app/providers).
 * Everything else under `$set` / `$set_once` is scrubbed like any property.
 * Both SDKs' `before_send` hooks apply this to an event's `$set` and
 * `$set_once`, and `scrubProperties` to its `properties`.
 */
const INTENDED_PERSON_PROPERTIES = new Set(["email", "name"]);

export function scrubPersonProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(properties)) {
    result[key] = INTENDED_PERSON_PROPERTIES.has(key) ? item : scrubValue(item, false, 1);
  }
  return result;
}

/**
 * Session replay data is compressed before `before_send` sees it and is
 * masked at the source instead (src/instrumentation-client.ts).
 */
const NOT_SCRUBBED = new Set(["$snapshot_data", "$snapshot_bytes"]);

/**
 * A copy of an event's properties with every string scrubbed. Properties of
 * an exception event (`$exception_*`) additionally lose standalone six-digit
 * numbers. Keys and non-string values are untouched.
 */
export function scrubProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (NOT_SCRUBBED.has(key)) result[key] = value;
    else if ((key === "$set" || key === "$set_once") && isRecord(value)) {
      result[key] = scrubPersonProperties(value);
    }
    else result[key] = scrubValue(value, key.startsWith("$exception"), 0);
  }
  return result;
}
