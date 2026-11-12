import { env } from "~/env";

const encoder = new TextEncoder();

let hmacKey: Promise<CryptoKey> | undefined;

function getHmacKey(): Promise<CryptoKey> {
  hmacKey ??= crypto.subtle.importKey(
    "raw",
    encoder.encode(env.AUTH_SECRET),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return hmacKey;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stable, non-reversible stand-in for a personal identifier (email address,
 * IP address) for use in logs, analytics ids and rate-limit keys.
 *
 * HMAC-SHA-256 keyed with AUTH_SECRET rather than a bare hash: email addresses
 * and IPv4 addresses are guessable, so an unkeyed digest could be reversed by
 * enumeration. Truncated to 128 bits, which is ample for a lookup key.
 *
 * `label` separates uses, so that the same input does not produce the same
 * value in two unrelated places.
 */
export async function keyedHash(label: string, value: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await getHmacKey(),
    encoder.encode(`${label}\u0000${value}`),
  );
  return toHex(new Uint8Array(signature).subarray(0, 16));
}

/** Pseudonymous id for an email address in logs and analytics. */
export function hashEmail(email: string): Promise<string> {
  return keyedHash("email", email.trim().toLowerCase());
}

/**
 * Compares two strings without leaking, through timing, how many leading
 * characters match. Both sides are HMACed first, so the comparison loop always
 * runs over two 32-byte digests whatever the inputs' lengths.
 */
export async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  const key = await getHmacKey();
  const [da, db] = await Promise.all([
    crypto.subtle.sign("HMAC", key, encoder.encode(`eq\u0000${a}`)),
    crypto.subtle.sign("HMAC", key, encoder.encode(`eq\u0000${b}`)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}
