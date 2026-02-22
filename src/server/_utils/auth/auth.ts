import { logger } from "~/_utils";
import { db } from "~/server/db";

export const checkIfUserExists = async (email: string) => {
  const user = await db.user.findFirst({
    where: {
      email,
    },
  });

  logger.info("Checking if user exists", { userExists: !!user });

  return !!user;
}

/**
 * Generate a cryptographically secure verification code
 * Uses Web Crypto API for edge-compatible random generation
 * Uses rejection sampling to avoid modulo bias
 * @returns 6-digit numeric code for email verification
 * @throws Error if unable to generate after 100 attempts (extremely unlikely)
 */
export const generateVerificationCode = (): string => {
  const array = new Uint32Array(1);
  let value: number;
  let attempts = 0;
  const MAX_ATTEMPTS = 100;

  // Rejection sampling to avoid modulo bias
  // Max Uint32 is 4,294,967,295
  // We reject values >= 4,294,000,000 to eliminate bias
  // Rejection probability: ~0.0225% per iteration
  do {
    if (attempts++ >= MAX_ATTEMPTS) {
      throw new Error(
        'Failed to generate random verification code after ' +
        MAX_ATTEMPTS +
        ' attempts. This indicates a potential issue with the random number generator.'
      );
    }
    crypto.getRandomValues(array);
    value = array[0] ?? 0;
  } while (value >= 4294000000);

  // Now we can safely use modulo without significant bias
  const code = (value % 1000000).toString().padStart(6, '0');
  return code;
}