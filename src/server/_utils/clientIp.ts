/**
 * True inside the Cloudflare Worker. OpenNext defines this symbol on
 * globalThis at startup, before any application module is evaluated.
 */
export function isCloudflareRuntime(): boolean {
  return Symbol.for("__cloudflare-context__") in globalThis;
}

/**
 * Collapses an IPv6 address to its /64 prefix: a single subscriber controls a
 * whole /64, so counting full addresses would let them rotate through 2^64 of
 * them. IPv4 addresses (and IPv4-mapped IPv6) are returned as they are.
 */
export function normalizeIp(ip: string): string {
  const value = ip.trim().toLowerCase();
  if (!value.includes(":")) return value;

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped?.[1]) return mapped[1];

  const [head = "", tail] = value.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = Math.max(0, 8 - headGroups.length - tailGroups.length);
  const groups =
    tail === undefined
      ? headGroups
      : [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups];

  const prefix = groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":");
  return `${prefix}::/64`;
}

/**
 * The address a request came from, for rate limiting.
 *
 * On Cloudflare only `CF-Connecting-IP` is trusted: the edge sets it and
 * overwrites any value a client sends. `X-Forwarded-For` is client-controlled
 * there and is never read. A request that somehow lacks the header falls into
 * one shared "unknown" bucket, which errs on the side of limiting.
 *
 * Off Cloudflare (`next dev`, `next start`) there is no trusted proxy at all,
 * so the usual proxy headers are accepted for convenience.
 */
export function getClientIp(headers: Headers): string {
  const cfIp = headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return normalizeIp(cfIp);
  if (isCloudflareRuntime()) return "unknown";

  const forwarded =
    headers.get("x-real-ip")?.trim() ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ? normalizeIp(forwarded) : "local";
}
