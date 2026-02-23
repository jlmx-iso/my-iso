/**
 * Generate an invite code in the format: ISO-{HANDLE}-{RANDOM}
 *
 * HANDLE = first 5 chars of the name, uppercased alphanumeric only (min 3 chars, padded with X).
 * RANDOM = 4 chars from an unambiguous charset via crypto.getRandomValues() (edge-compatible).
 * Uses rejection sampling to avoid modulo bias.
 */
export function generateInviteCode(name: string): string {
  const charset = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 30 chars
  const handle = name
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 5)
    .padEnd(3, "X");

  let random = "";
  // Rejection sampling: largest multiple of 30 that fits in a byte is 240 (30 * 8)
  const maxValid = 240;
  while (random.length < 4) {
    const bytes = new Uint8Array(4 - random.length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (random.length >= 4) break;
      if (byte < maxValid) {
        random += charset[byte % charset.length];
      }
    }
  }

  return `ISO-${handle}-${random}`;
}

/**
 * Generate a unique invite code, retrying on collision.
 * Throws if no unique code can be generated after maxAttempts.
 */
export async function generateUniqueInviteCode(
  name: string,
  checkExists: (code: string) => Promise<boolean>,
  maxAttempts = 5,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateInviteCode(name);
    const exists = await checkExists(code);
    if (!exists) return code;
  }
  throw new Error(
    "Failed to generate a unique invite code after maximum attempts. Please try again.",
  );
}
