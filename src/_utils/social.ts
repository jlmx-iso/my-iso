import { z } from "zod";

// ---------------------------------------------------------------------------
// Generic handle validator — permissive enough to cover all platforms
// ---------------------------------------------------------------------------

const HANDLE_RE = /^[a-zA-Z0-9._\-]{1,100}$/;

export function isValidSocialHandle(value: string): boolean {
  return HANDLE_RE.test(value.replace(/^@/, ""));
}

export function normalizeSocialHandle(value: string): string {
  return value.trim().replace(/^@/, "");
}

/** Zod: optional handle — normalizes to bare handle on output. */
export const socialHandleOptional = z
  .string()
  .refine((v) => !v || isValidSocialHandle(v), "Enter a valid handle (e.g. yourhandle)")
  .transform((v) => (v ? normalizeSocialHandle(v) : v))
  .optional();

/** Zod: nullable handle — null means the field is cleared. */
export const socialHandleNullable = z
  .string()
  .nullable()
  .refine((v) => !v || isValidSocialHandle(v), "Enter a valid handle (e.g. yourhandle)")
  .transform((v) => (v ? normalizeSocialHandle(v) : null));

// ---------------------------------------------------------------------------
// Per-platform normalize (strips full URLs to bare handles)
// ---------------------------------------------------------------------------

function stripUrl(value: string, pattern: RegExp): string {
  return value.trim().replace(pattern, "").replace(/^@/, "").replace(/\/$/, "");
}

export function normalizeFacebookHandle(v: string) {
  return stripUrl(v, /^https?:\/\/(www\.)?facebook\.com\/?/);
}
export function normalizeTwitterHandle(v: string) {
  return stripUrl(v, /^https?:\/\/(www\.)?(twitter|x)\.com\/?/);
}
export function normalizeTikTokHandle(v: string) {
  return stripUrl(v, /^https?:\/\/(www\.)?tiktok\.com\/@?/);
}
export function normalizeVimeoHandle(v: string) {
  return stripUrl(v, /^https?:\/\/(www\.)?vimeo\.com\/?/);
}
export function normalizeYouTubeHandle(v: string) {
  return stripUrl(v, /^https?:\/\/(www\.)?youtube\.com\/@?/);
}

// ---------------------------------------------------------------------------
// Per-platform URL builders (handle stored data → full link)
// ---------------------------------------------------------------------------

export function facebookUrl(handle: string) {
  if (handle.startsWith("http")) return handle;
  return `https://facebook.com/${handle}`;
}
export function twitterUrl(handle: string) {
  if (handle.startsWith("http")) return handle;
  return `https://x.com/${handle}`;
}
export function tikTokUrl(handle: string) {
  if (handle.startsWith("http")) return handle;
  return `https://tiktok.com/@${handle}`;
}
export function vimeoUrl(handle: string) {
  if (handle.startsWith("http")) return handle;
  return `https://vimeo.com/${handle}`;
}
export function youTubeUrl(handle: string) {
  if (handle.startsWith("http")) return handle;
  return `https://youtube.com/@${handle}`;
}
