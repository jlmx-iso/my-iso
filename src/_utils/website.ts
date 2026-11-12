import { toSafeWebsiteUrl } from "./social";

/**
 * Normalises an optional website field.
 *  - empty input      -> `{ ok: true, value: null }` (the field is optional)
 *  - "mysite.com"     -> `{ ok: true, value: "https://mysite.com/" }`
 *  - anything invalid -> `{ ok: false }`
 */
export function parseOptionalWebsite(
  input: string | null | undefined,
): { ok: true; value: string | null } | { ok: false } {
  const trimmed = input?.trim() ?? "";
  if (trimmed === "") return { ok: true, value: null };
  if (/\s/.test(trimmed)) return { ok: false };

  const url = toSafeWebsiteUrl(trimmed);
  if (!url) return { ok: false };
  // Require a real host ("example.com"), not a bare word.
  const { hostname } = new URL(url);
  if (!/^[^.]+(\.[^.]+)+$/.test(hostname)) return { ok: false };
  return { ok: true, value: url };
}
