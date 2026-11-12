/** No 0/O, 1/I/L: codes are read aloud and typed by hand. */
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 30 chars
export const INVITE_CODE_RANDOM_LENGTH = 8;

/**
 * Generate an invite code in the format: ISO-{HANDLE}-{RANDOM}
 *
 * HANDLE = first 5 chars of the name, uppercased alphanumeric only (min 3 chars, padded with X).
 * RANDOM = 8 chars from an unambiguous 30-character alphabet via
 * crypto.getRandomValues(): 30^8 (about 6.6e11) possibilities per handle, so
 * that guessing a live code through the rate-limited validation endpoint is
 * not practical. Uses rejection sampling to avoid modulo bias.
 */
export function generateInviteCode(name: string): string {
  const handle = name
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 5)
    .padEnd(3, "X");

  let random = "";
  // Rejection sampling: largest multiple of 30 that fits in a byte is 240 (30 * 8)
  const maxValid = 240;
  while (random.length < INVITE_CODE_RANDOM_LENGTH) {
    const bytes = new Uint8Array(INVITE_CODE_RANDOM_LENGTH - random.length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (random.length >= INVITE_CODE_RANDOM_LENGTH) break;
      if (byte < maxValid) {
        random += INVITE_CODE_ALPHABET[byte % INVITE_CODE_ALPHABET.length];
      }
    }
  }

  return `ISO-${handle}-${random}`;
}

/** Normalises user input before a code lookup. */
export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase();
}
