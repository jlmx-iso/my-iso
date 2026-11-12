import type { InviteCode } from "@prisma/client";

import { generateInviteCode, normalizeInviteCode } from "~/server/_utils/invite";
import { USER_ROLES, WAITLIST_APPROVED_CODE } from "~/server/_utils/roles";

import { isUniqueViolation } from "./errors";
import type { ExtendedPrismaClient } from "./softDelete";

/**
 * Invite redemption without transactions.
 *
 * Cloudflare D1 has no interactive transactions, so capacity is enforced by
 * one conditional UPDATE (`claimInviteSlot`): the database either increments
 * the counter and reports the row, or reports nothing. Two sign-ups racing
 * for the last slot therefore cannot both get it. Everything after the claim
 * is ordered so that a failure part-way through can only leave a slot counted
 * as used that was not (which is then released on a best-effort basis), never
 * a member admitted without a slot.
 */

type InviteDb = Pick<
  ExtendedPrismaClient,
  "$executeRaw" | "$queryRaw" | "inviteCode" | "inviteRedemption" | "pendingInviteValidation" | "user"
>;

export type InviteSlot = { creatorId: string; inviteCodeId: string };

/** What entitles a new account to exist while sign-up is invite-only. */
export type InviteGrant =
  | { kind: "waitlist" }
  | ({ kind: "invite" } & InviteSlot);

/**
 * Atomically takes one redemption of `code` if any is left.
 * Returns null when the code does not exist or is used up.
 */
export async function claimInviteSlot(
  db: Pick<InviteDb, "$queryRaw">,
  code: string,
): Promise<InviteSlot | null> {
  const rows = await db.$queryRaw<Array<{ creatorId: string; id: string }>>`
    UPDATE "InviteCode"
    SET "currentRedemptions" = "currentRedemptions" + 1
    WHERE "code" = ${normalizeInviteCode(code)}
      AND "currentRedemptions" < "maxRedemptions"
    RETURNING "id", "creatorId"`;

  const row = rows[0];
  return row ? { creatorId: row.creatorId, inviteCodeId: row.id } : null;
}

/** Gives back a slot taken by `claimInviteSlot` whose sign-up did not complete. */
export async function releaseInviteSlot(
  db: Pick<InviteDb, "$executeRaw">,
  inviteCodeId: string,
): Promise<void> {
  await db.$executeRaw`
    UPDATE "InviteCode"
    SET "currentRedemptions" = "currentRedemptions" - 1
    WHERE "id" = ${inviteCodeId} AND "currentRedemptions" > 0`;
}

/** Read-only check used to turn people away early; `claimInviteSlot` decides. */
export async function isInviteRedeemable(
  db: Pick<InviteDb, "inviteCode">,
  code: string,
): Promise<boolean> {
  if (code === WAITLIST_APPROVED_CODE) return true;
  const invite = await db.inviteCode.findUnique({
    select: { currentRedemptions: true, maxRedemptions: true },
    where: { code: normalizeInviteCode(code) },
  });
  return invite !== null && invite.currentRedemptions < invite.maxRedemptions;
}

/**
 * Turns a pending invite validation into a grant: a waitlist approval needs
 * no slot, an invite code must still have one. Returns null when it does not.
 */
export async function reserveInviteGrant(
  db: Pick<InviteDb, "$queryRaw">,
  pendingCode: string,
): Promise<InviteGrant | null> {
  if (pendingCode === WAITLIST_APPROVED_CODE) return { kind: "waitlist" };
  const slot = await claimInviteSlot(db, pendingCode);
  return slot ? { kind: "invite", ...slot } : null;
}

export async function releaseInviteGrant(
  db: Pick<InviteDb, "$executeRaw">,
  grant: InviteGrant,
): Promise<void> {
  if (grant.kind === "invite") await releaseInviteSlot(db, grant.inviteCodeId);
}

/**
 * Returns the user's own invite code, creating it on first use. Safe to call
 * concurrently: `creatorId` and `code` are unique, so a lost race surfaces as
 * a constraint violation and resolves to the row that won.
 */
export async function ensureInviteCode(
  db: Pick<InviteDb, "inviteCode">,
  userId: string,
  name: string,
  maxAttempts = 5,
): Promise<InviteCode> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const existing = await db.inviteCode.findUnique({ where: { creatorId: userId } });
    if (existing) return existing;

    try {
      return await db.inviteCode.create({
        data: { code: generateInviteCode(name || "USER"), creatorId: userId },
      });
    } catch (error) {
      // Either this user's code was created concurrently (found on the next
      // pass) or the random code collided (a new one is drawn).
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("Failed to generate a unique invite code. Please try again.");
}

/**
 * Records what a reserved grant gives `userId`: founding-member role, the
 * inviter link and redemption row, the member's own invite code; then drops
 * the pending validation. The user row must already exist.
 *
 * If recording the redemption fails the slot is released before the error
 * propagates.
 */
export async function applyInviteGrant(
  db: InviteDb,
  params: {
    firstName: string;
    grant: InviteGrant;
    pendingId: string;
    userId: string;
  },
): Promise<void> {
  const { firstName, grant, pendingId, userId } = params;

  if (grant.kind === "invite") {
    try {
      await db.inviteRedemption.create({
        data: { inviteCodeId: grant.inviteCodeId, redeemedById: userId },
      });
    } catch (error) {
      await releaseInviteSlot(db, grant.inviteCodeId);
      throw error;
    }
  }

  await db.user.update({
    data: {
      role: USER_ROLES.FOUNDING_MEMBER,
      ...(grant.kind === "invite" ? { invitedByUserId: grant.creatorId } : {}),
    },
    where: { id: userId },
  });

  await ensureInviteCode(db, userId, firstName);

  // deleteMany: a missing row (already consumed) is not an error.
  await db.pendingInviteValidation.deleteMany({ where: { id: pendingId } });
}
