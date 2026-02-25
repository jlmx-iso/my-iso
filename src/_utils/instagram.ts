import { z } from "zod";

/**
 * Strip @, leading URL, and trailing slashes.
 * Accepts: @handle, handle, https://instagram.com/handle
 */
export function normalizeInstagramHandle(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\/?/, "")
    .replace(/^@/, "")
    .replace(/\/$/, "");
}

/** Instagram handles: letters, numbers, underscores, periods — max 30 chars. */
export function isValidInstagramHandle(value: string): boolean {
  return /^[a-zA-Z0-9._]{1,30}$/.test(normalizeInstagramHandle(value));
}

/** Build the full profile URL from a stored handle. */
export function instagramUrl(handle: string): string {
  // Handle legacy data that was stored as a full URL
  if (handle.startsWith("http")) return handle;
  return `https://instagram.com/${handle}`;
}

/** Zod: optional handle — if provided, must be valid; normalizes on output. */
export const instagramHandleOptional = z
  .string()
  .refine((v) => !v || isValidInstagramHandle(v), "Enter a valid Instagram handle (e.g. yourhandle)")
  .transform((v) => (v ? normalizeInstagramHandle(v) : v))
  .optional();

/** Zod: nullable handle — null means "no instagram"; normalizes on output. */
export const instagramHandleNullable = z
  .string()
  .nullable()
  .refine((v) => !v || isValidInstagramHandle(v), "Enter a valid Instagram handle (e.g. yourhandle)")
  .transform((v) => (v ? normalizeInstagramHandle(v) : null));
