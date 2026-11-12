/**
 * Rules for a member's handle, the last segment of their public profile URL
 * (`/photographer/<handle>`): lowercase letters, digits and underscores,
 * 3 to 30 characters. The server enforces the same rules.
 */
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;
export const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

/** What people tend to type: a leading "@", capitals, stray spaces. */
export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@+/, "").toLowerCase();
}

/**
 * Validation message for a handle as typed, or null when it is acceptable.
 * An empty handle is acceptable: the field is optional.
 */
export function validateHandle(input: string): string | null {
  const handle = normalizeHandle(input);
  if (handle === "") return null;
  if (handle.length < HANDLE_MIN_LENGTH) {
    return `Use at least ${HANDLE_MIN_LENGTH} characters`;
  }
  if (handle.length > HANDLE_MAX_LENGTH) {
    return `Use at most ${HANDLE_MAX_LENGTH} characters`;
  }
  if (!HANDLE_PATTERN.test(handle)) {
    return "Use only lowercase letters, numbers and underscores";
  }
  return null;
}

/** Public profile URL for a handle, exactly as the route matches it (no "@"). */
export function publicProfileUrl(baseUrl: string, handle: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/photographer/${normalizeHandle(handle)}`;
}
