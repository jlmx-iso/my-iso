import { z } from "zod";

// ---------------------------------------------------------------------------
// Generic handle validator — permissive enough to cover all platforms
// ---------------------------------------------------------------------------

const HANDLE_RE = /^[a-zA-Z0-9._\-]{1,100}$/;

export function isValidSocialHandle(value: string): boolean {
  return HANDLE_RE.test(value.trim().replace(/^@/, ""));
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

/**
 * Only pass through a URL value if its hostname matches one of the allowed
 * hosts. Otherwise fall back to constructing the canonical URL from the handle.
 */
function passthroughIfAllowed(value: string, allowedHosts: string[]): string | null {
  try {
    const url = new URL(value);
    return allowedHosts.includes(url.hostname) ? value : null;
  } catch {
    return null;
  }
}

export function facebookUrl(handle: string) {
  if (handle.startsWith("http")) {
    return passthroughIfAllowed(handle, ["facebook.com", "www.facebook.com"]) ?? `https://facebook.com/${handle}`;
  }
  return `https://facebook.com/${handle}`;
}
export function twitterUrl(handle: string) {
  if (handle.startsWith("http")) {
    return passthroughIfAllowed(handle, ["x.com", "www.x.com", "twitter.com", "www.twitter.com"]) ?? `https://x.com/${handle}`;
  }
  return `https://x.com/${handle}`;
}
export function tikTokUrl(handle: string) {
  if (handle.startsWith("http")) {
    return passthroughIfAllowed(handle, ["tiktok.com", "www.tiktok.com"]) ?? `https://tiktok.com/@${handle}`;
  }
  return `https://tiktok.com/@${handle}`;
}
export function vimeoUrl(handle: string) {
  if (handle.startsWith("http")) {
    return passthroughIfAllowed(handle, ["vimeo.com", "www.vimeo.com"]) ?? `https://vimeo.com/${handle}`;
  }
  return `https://vimeo.com/${handle}`;
}
export function youTubeUrl(handle: string) {
  if (handle.startsWith("http")) {
    return passthroughIfAllowed(handle, ["youtube.com", "www.youtube.com", "youtu.be"]) ?? `https://youtube.com/@${handle}`;
  }
  return `https://youtube.com/@${handle}`;
}
