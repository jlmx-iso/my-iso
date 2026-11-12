/** Where sign-in lands when no (valid) callbackUrl was requested. */
export const DEFAULT_SIGNED_IN_PATH = "/app/events";

// Only used to resolve relative URLs; never appears in the result.
const PLACEHOLDER_ORIGIN = "http://callback.invalid";

/**
 * Returns `callbackUrl` if it is a relative URL within this site (path, query
 * and hash), and `fallback` otherwise.
 *
 * The value comes from the query string of /login, so anything that could
 * leave the site is rejected: absolute URLs, protocol-relative URLs (`//host`),
 * backslash variants browsers treat as slashes, and control characters.
 */
export function sanitizeCallbackUrl(
  callbackUrl: string | null | undefined,
  fallback: string = DEFAULT_SIGNED_IN_PATH,
): string {
  if (!callbackUrl?.startsWith("/")) return fallback;
  if (callbackUrl.startsWith("//") || callbackUrl.includes("\\")) return fallback;
   
  if (/[\u0000-\u001f\u007f]/.test(callbackUrl)) return fallback;

  let url: URL;
  try {
    url = new URL(callbackUrl, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;

  return `${url.pathname}${url.search}${url.hash}`;
}
