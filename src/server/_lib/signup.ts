import type { User } from "@prisma/client";
import { z } from "zod";

import { logger } from "~/_utils";
import { isUniqueViolation } from "~/server/_db/errors";
import {
  applyInviteGrant,
  releaseInviteGrant,
  reserveInviteGrant,
  type InviteGrant,
} from "~/server/_db/invite";
import { type ExtendedPrismaClient, INCLUDING_DELETED } from "~/server/_db/softDelete";
import { verifyOtp } from "~/server/_db/verificationToken";
import { checkRateLimitsInOrder, otpVerifyLimits } from "~/server/_utils/rateLimit";

/**
 * Account creation and email-code sign-in, independent of Auth.js so that it
 * can be exercised against a real database in tests. src/auth.ts wires these
 * into the `otp` credentials provider and the database adapter.
 */

type SignupDb = Pick<
  ExtendedPrismaClient,
  | "$executeRaw"
  | "$queryRaw"
  | "inviteCode"
  | "inviteRedemption"
  | "pendingInviteValidation"
  | "user"
  | "verificationToken"
>;

/**
 * The address belongs to an account whose deletion has started but not
 * finished: its row still holds the address until the last step
 * anonymises it (~/server/_lib/account/deletion).
 */
export class AccountDeletionPendingError extends Error {
  constructor() {
    super("This account is still being deleted.");
    this.name = "AccountDeletionPendingError";
  }
}

/** Whether `email` is held by an account that is being deleted. */
export async function isDeletionPending(db: Pick<SignupDb, "user">, email: string): Promise<boolean> {
  return (await db.user.count({ where: { ...INCLUDING_DELETED, email, isDeleted: true } })) > 0;
}

export type NewUserProfile = {
  email: string;
  emailVerified: Date | null;
  firstName: string;
  lastName: string;
};

export function findPendingInvite(
  db: Pick<SignupDb, "pendingInviteValidation">,
  email: string,
) {
  return db.pendingInviteValidation.findFirst({
    where: { email, expiresAt: { gt: new Date() } },
  });
}

/**
 * Creates the account of someone signing up, enforcing the invite.
 *
 * The invite slot is claimed atomically BEFORE the user row is written, and
 * the claim is undone if anything after it fails, so an exhausted or deleted
 * invite code can never produce a member (see ~/server/_db/invite).
 *
 * `isInviteOnly` is consulted only when there is no usable invite: if it
 * resolves to false (open registration) the account is created as a standard
 * member. Returns null when the sign-up is not allowed.
 */
export async function createInvitedUser(
  db: SignupDb,
  profile: NewUserProfile,
  isInviteOnly: (email: string) => Promise<boolean>,
): Promise<User | null> {
  const pending = await findPendingInvite(db, profile.email);

  let grant: InviteGrant | null = null;
  if (pending) {
    grant = await reserveInviteGrant(db, pending.code);
    if (!grant) {
      // The code was used up or regenerated after /join validated it.
      await db.pendingInviteValidation.deleteMany({ where: { id: pending.id } });
    }
  }

  if (!grant && (await isInviteOnly(profile.email))) {
    logger.warn("Sign-up rejected: no valid invite", { hadPendingInvite: pending !== null });
    return null;
  }

  let user: User;
  try {
    user = await db.user.create({ data: profile });
  } catch (error) {
    if (grant) await releaseInviteGrant(db, grant);
    if (isUniqueViolation(error) && (await isDeletionPending(db, profile.email))) {
      throw new AccountDeletionPendingError();
    }
    throw error;
  }

  if (!grant || !pending) return user;

  try {
    await applyInviteGrant(db, {
      firstName: profile.firstName,
      grant,
      pendingId: pending.id,
      userId: user.id,
    });
  } catch (error) {
    // Do not leave a half-set-up account behind: it would count as an
    // existing user on the next sign-in and skip the invite check.
    // (applyInviteGrant has already released the slot if it was the
    // redemption that failed; a later step failing keeps the slot used,
    // which errs on the side of admitting fewer people, never more.)
    await db.user.delete({ where: { id: user.id } }).catch((cleanupError: unknown) => {
      logger.error("Failed to remove user after invite redemption error", {
        error: cleanupError,
        userId: user.id,
      });
    });
    throw error;
  }

  return db.user.findUniqueOrThrow({ where: { id: user.id } });
}

const otpCredentials = z.object({
  code: z.string().regex(/^\d{6}$/),
  email: z.string().trim().toLowerCase().email().max(254),
});

export type OtpSignInResult =
  | { status: "ok"; user: User }
  /** Wrong/expired/used code, malformed input, or a sign-up without invite. */
  | { status: "rejected" }
  /** Over the limit, or the limiter itself failed (fail closed). */
  | { status: "rate_limited" }
  /** The address belongs to an account still being deleted. */
  | { status: "deletion_pending" };

/**
 * Email-code sign-in for the web (`POST /api/auth/callback/otp`).
 *
 * Applies the same limits (per client, per client-and-address, and per
 * address; 15-minute and daily, see otpVerifyLimits) and the same
 * attempt-capped, constant-time verification as the mobile tRPC procedure.
 * An invitee has no
 * account until their first code checks out; it is created here.
 */
export async function signInWithOtp(
  db: SignupDb,
  credentials: unknown,
  clientIp: string,
  isInviteOnly: (email: string) => Promise<boolean>,
): Promise<OtpSignInResult> {
  const parsed = otpCredentials.safeParse(credentials);
  if (!parsed.success) return { status: "rejected" };
  const { code, email } = parsed.data;

  // The client's own limits first: once it is over any of them, the
  // counters it shares with the address's owner are not touched (see
  // otpVerifyLimits), so it cannot lock the owner out.
  const refused = await checkRateLimitsInOrder(db, otpVerifyLimits(clientIp, email));
  if (refused) return { status: "rate_limited" };

  if (!(await verifyOtp(db, email, code))) return { status: "rejected" };

  const existing = await db.user.findUnique({ where: { email } });
  if (!existing && (await isDeletionPending(db, email))) return { status: "deletion_pending" };
  const user =
    existing ??
    (await createInvitedUser(
      db,
      { email, emailVerified: new Date(), firstName: "", lastName: "" },
      isInviteOnly,
    ));

  return user ? { status: "ok", user } : { status: "rejected" };
}
