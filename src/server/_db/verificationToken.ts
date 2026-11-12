import { Prisma } from "@prisma/client";

import { generateVerificationCode } from "~/server/_utils/auth";
import { timingSafeEqualStrings } from "~/server/_utils/hash";

import type { ExtendedPrismaClient } from "./softDelete";

/**
 * Email sign-in codes ("OTP").
 *
 * A code is a VerificationToken row with identifier "otp:<email>". Rows are
 * always looked up by identifier, never by code alone: a 6-digit value is not
 * unique across users.
 *
 * Brute-force protection lives on the row itself: every verification attempt
 * increments `attempts` in one atomic UPDATE before the guess is looked at,
 * and a code is only accepted while its counter is within OTP_MAX_ATTEMPTS.
 * A caller who sends many guesses at once (tRPC batch, parallel requests)
 * therefore still gets at most OTP_MAX_ATTEMPTS evaluated.
 */

/** Verification attempts a code survives; the next one invalidates it. */
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_TTL_MS = 10 * 60 * 1000;

type OtpDb = { verificationToken: ExtendedPrismaClient["verificationToken"] };

export function otpIdentifier(email: string): string {
  return `otp:${email.trim().toLowerCase()}`;
}

/**
 * Replaces any code previously issued to `email` with a fresh one and returns
 * it. Also sweeps expired tokens of every kind, so the table cannot grow
 * without bound.
 */
export async function issueOtp(
  db: OtpDb,
  email: string,
  options: { code?: string; now?: Date } = {},
): Promise<string> {
  const now = options.now ?? new Date();
  const identifier = otpIdentifier(email);
  const code = options.code ?? generateVerificationCode();

  await db.verificationToken.deleteMany({
    where: { OR: [{ identifier }, { expires: { lt: now } }] },
  });

  try {
    await db.verificationToken.create({
      data: {
        expires: new Date(now.getTime() + OTP_TTL_MS),
        identifier,
        token: code,
      },
    });
  } catch (error) {
    // A concurrent request for the same address drew the same code: it is
    // stored, which is all this call needs.
    const isDuplicate =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    if (!isDuplicate) throw error;
  }

  return code;
}

/**
 * Checks `code` against the code(s) issued to `email` and consumes the code
 * on success. Returns false for a wrong, expired, already used or
 * attempt-exhausted code, and when no code was issued at all; callers must
 * not tell these cases apart to the client.
 */
export async function verifyOtp(
  db: OtpDb,
  email: string,
  code: string,
  options: { now?: Date } = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  const identifier = otpIdentifier(email);

  // Count the attempt first, atomically, so that concurrent guesses each see
  // a different (or higher) counter value.
  const counted = await db.verificationToken.updateMany({
    data: { attempts: { increment: 1 } },
    where: { identifier },
  });
  if (counted.count === 0) return false;

  const rows = await db.verificationToken.findMany({ where: { identifier } });

  let matched: string | null = null;
  let hasDeadRows = false;
  for (const row of rows) {
    const usable = row.expires > now && row.attempts <= OTP_MAX_ATTEMPTS;
    // Always compare, usable or not, so timing does not depend on row state.
    const equal = await timingSafeEqualStrings(row.token, code);
    if (usable && equal) matched = row.token;
    // The attempt that reaches the cap is still evaluated, but it is the
    // last: the row is removed whether or not it matched.
    if (!usable || row.attempts >= OTP_MAX_ATTEMPTS) hasDeadRows = true;
  }

  if (matched === null) {
    if (hasDeadRows) {
      await db.verificationToken.deleteMany({
        where: {
          identifier,
          OR: [{ expires: { lte: now } }, { attempts: { gte: OTP_MAX_ATTEMPTS } }],
        },
      });
    }
    return false;
  }

  // Single use: only the request whose DELETE removes the row wins.
  const consumed = await db.verificationToken.deleteMany({
    where: { identifier, token: matched },
  });
  if (consumed.count !== 1) return false;

  // Any sibling code for the same address is void once one has been used.
  await db.verificationToken.deleteMany({ where: { identifier } });
  return true;
}
