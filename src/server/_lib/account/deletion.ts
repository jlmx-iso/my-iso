// Account deletion: what happens to a member's data when they delete their
// account. The policy is in docs/DATABASE.md ("Account deletion"); this is
// its one implementation.
//
// D1 has no interactive transactions, so this is a sequence of steps, each
// idempotent, run in an order that is safe to stop anywhere and start again:
//
//   1. requestAccountDeletion: one conditional UPDATE sets `isDeleted` and
//      `deletionRequestedAt`. From that statement on the account is gone
//      for every read (soft-delete extension), which also ends its sessions
//      (auth.ts). Nothing else has changed yet.
//   2. runAccountDeletion: ends billing in Stripe, deletes the uploaded
//      images, closes live chat sockets, erases the PostHog person, then
//      deletes or anonymises the rows (other members' notifications that
//      name the member included), and last of all anonymises the User row
//      and sets `deletedAt`. A failure leaves
//      `deletedAt` null; the finish-deletions job (src/server/_jobs)
//      runs it again until it completes.
//   3. The confirmation email goes to the address read before step 2
//      anonymised it, once `deletedAt` was set by this run.

import { logger } from "~/_utils";
import { type ExtendedPrismaClient, INCLUDING_DELETED } from "~/server/_db/softDelete";
import { otpIdentifier } from "~/server/_db/verificationToken";
import { captureServerException } from "~/server/_lib/posthog";

/** How the account appears to others afterwards: "Deleted member". */
export const DELETED_MEMBER = { firstName: "Deleted", lastName: "member" } as const;
export const DELETED_MEMBER_NAME = `${DELETED_MEMBER.firstName} ${DELETED_MEMBER.lastName}`;

/**
 * The email address a deleted account keeps: unique (the column is), never
 * deliverable (`.invalid` is reserved), and saying nothing about the member.
 */
export function deletedAccountEmail(userId: string): string {
  return `deleted-${userId}@deleted.invalid`;
}

export type DeletionDb = Pick<
  ExtendedPrismaClient,
  | "account"
  | "booking"
  | "comment"
  | "commentLike"
  | "event"
  | "eventLike"
  | "eventView"
  | "favorite"
  | "inviteCode"
  | "inviteRedemption"
  | "match"
  | "messageThread"
  | "notification"
  | "pendingInviteValidation"
  | "photographer"
  | "portfolioImage"
  | "profileView"
  | "review"
  | "session"
  | "subscription"
  | "swipe"
  | "threadRead"
  | "user"
  | "verificationToken"
  | "waitlist"
>;

/** The outside world: each must be safe to call again for the same thing. */
export type DeletionDeps = {
  /**
   * Cancels a Stripe subscription now and voids its open invoices; a no-op
   * for what has already ended.
   */
  endBilling: (subscriptionId: string) => Promise<void>;
  /** Deletes uploaded images by their stored URL; gone ones count as deleted. */
  deleteImages: (urls: string[]) => Promise<void>;
  /** Closes the member's open chat sockets in these threads' rooms. */
  revokeRealtime: (userId: string, threadIds: string[]) => Promise<void>;
  /**
   * Deletes the PostHog person (distinct id = user id) with its events and
   * recordings; "skipped" when PostHog erasure is not configured.
   */
  eraseAnalytics: (userId: string) => Promise<"requested" | "skipped">;
  /** The "your account was deleted" email. */
  sendConfirmation: (to: { email: string; firstName: string }) => Promise<void>;
};


/** Bookings looked up per notification query (D1's bound-parameter limit). */
export const NOTIFICATION_CHUNK = 50;

/** How booking notifications name a member (booking.ts, `displayName`). */
function displayName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

/**
 * Rewrites other members' booking notifications that name the deleted
 * member, replacing the name with "Deleted member". They are found through
 * the bookings the member was part of (each notification stores its
 * `bookingId`). Idempotent: once rewritten, the name is no longer there.
 */
export async function anonymiseNotificationsAbout(
  db: Pick<DeletionDb, "booking" | "notification">,
  userId: string,
  name: string,
): Promise<number> {
  if (name === "") return 0;
  const bookings = await db.booking.findMany({
    select: { id: true },
    where: { ...INCLUDING_DELETED, OR: [{ applicantId: userId }, { ownerId: userId }] },
  });
  let rewritten = 0;
  for (let start = 0; start < bookings.length; start += NOTIFICATION_CHUNK) {
    const chunk = bookings.slice(start, start + NOTIFICATION_CHUNK);
    const rows = await db.notification.findMany({
      select: { body: true, id: true },
      where: {
        OR: chunk.map((booking) => ({ data: { contains: `"bookingId":"${booking.id}"` } })),
        recipientId: { not: userId },
      },
    });
    for (const row of rows) {
      if (!row.body.includes(name)) continue;
      await db.notification.update({
        data: { body: row.body.split(name).join(DELETED_MEMBER_NAME) },
        where: { id: row.id },
      });
      rewritten += 1;
    }
  }
  return rewritten;
}

/**
 * Closes the account at once: one conditional UPDATE. True when this call
 * closed it, false when it was already closed (or does not exist).
 */
export async function requestAccountDeletion(
  db: Pick<DeletionDb, "user">,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { count } = await db.user.updateMany({
    data: { deletionRequestedAt: now, isDeleted: true },
    where: { id: userId, isDeleted: false },
  });
  return count === 1;
}

export type DeletionOutcome = "finished" | "not-pending";

/**
 * Carries out a requested deletion, or finishes one a previous run left
 * half done. "not-pending": nothing to do (never requested, or finished).
 * Throws when a step fails; everything before it is done and stays done.
 */
export async function runAccountDeletion(
  db: DeletionDb,
  userId: string,
  deps: DeletionDeps,
  now: Date = new Date(),
): Promise<DeletionOutcome> {
  const user = await db.user.findFirst({
    select: { email: true, firstName: true, id: true, lastName: true, profilePic: true },
    where: { deletedAt: null, id: userId, isDeleted: true },
  });
  if (!user) return "not-pending";

  // Counted before any step, so a run that fails part-way still counts
  // (the job gives up on an account after a few, see finishAccountDeletions).
  await db.user.updateMany({
    data: { deletionAttemptedAt: now, deletionAttempts: { increment: 1 } },
    where: { deletedAt: null, id: userId, isDeleted: true },
  });

  // 1. Billing. Cancelled now, not at the period's end: nobody is left to
  //    use what would remain, and nothing more is charged. No refund is made
  //    automatically for the unused part of the period (docs/DATABASE.md).
  //    Open invoices are voided, so a retried payment cannot charge either.
  //    Asked of Stripe whatever the row says (it may lag behind). The
  //    Subscription row stays: it is the billing record, updated by the
  //    webhook that follows the cancellation.
  const subscription = await db.subscription.findUnique({
    select: { subscriptionId: true },
    where: { userId },
  });
  if (subscription?.subscriptionId) await deps.endBilling(subscription.subscriptionId);

  // 2. Images, while the rows that hold their URLs still exist.
  const photographer = await db.photographer.findFirst({
    select: { avatar: true, id: true },
    where: { ...INCLUDING_DELETED, userId },
  });
  const photographerId = photographer?.id ?? null;
  const [portfolio, covers] = photographerId
    ? await Promise.all([
        db.portfolioImage.findMany({ select: { image: true }, where: { ...INCLUDING_DELETED, photographerId } }),
        db.event.findMany({ select: { image: true }, where: { ...INCLUDING_DELETED, photographerId } }),
      ])
    : [[], []];
  const images = [
    user.profilePic,
    photographer?.avatar ?? null,
    ...portfolio.map((row) => row.image),
    ...covers.map((row) => row.image),
  ].filter((url): url is string => typeof url === "string" && url.length > 0);
  if (images.length > 0) await deps.deleteImages(images);

  // Live chat: their open sockets close. New ones are already refused (the
  // gateway finds no session). Thread membership stays: the other side
  // keeps the conversation, with "Deleted member".
  const threads = await db.messageThread.findMany({
    select: { id: true },
    where: { participants: { some: { id: userId } } },
  });
  await deps.revokeRealtime(userId, threads.map((thread) => thread.id));

  // Analytics: the PostHog person with its events and recordings. When this
  // is not configured the step is recorded as skipped and reported, so the
  // owner can do it by hand; it does not hold the rest up.
  const skipped: string[] = [];
  if ((await deps.eraseAnalytics(userId)) === "skipped") skipped.push("posthog");

  // Other members' notifications that name them ("Ann Lee applied to ...").
  await anonymiseNotificationsAbout(db, userId, displayName(user));

  // 3. Their part in others' bookings: open ones end, their own notes go.
  //    The rows stay, so the other member keeps their history.
  await db.booking.updateMany({
    data: { cancelOrigin: "withdrawn", status: "canceled" },
    where: { applicantId: userId, status: "applied" },
  });
  await db.booking.updateMany({
    data: { cancelOrigin: "canceled_by_applicant", status: "canceled" },
    where: { applicantId: userId, status: "accepted" },
  });
  await db.booking.updateMany({
    data: { cancelOrigin: "canceled_by_owner", status: "canceled" },
    where: { ownerId: userId, status: { in: ["applied", "accepted"] } },
  });
  await db.booking.updateMany({ data: { notes: null }, where: { applicantId: userId } });
  await db.booking.updateMany({ data: { ownerNotes: null }, where: { ownerId: userId } });

  // 4. Their profile and what hangs off it.
  if (photographerId) {
    // Events leave every feed; title, date and place stay for applicants'
    // booking history, the description and cover go.
    await db.event.updateMany({
      data: { description: null, image: null, isDeleted: true },
      where: { photographerId },
    });
    await db.portfolioImage.deleteMany({ where: { photographerId } });
    // Pro insights counts of their events (counts only; nothing about viewers).
    await db.eventView.deleteMany({ where: { event: { photographerId } } });
    // Reviews of a profile that no longer exists.
    await db.review.deleteMany({ where: { photographerId } });
    await db.favorite.deleteMany({ where: { targetId: photographerId } });
    await db.photographer.updateMany({
      data: {
        avatar: null,
        bio: null,
        companyName: "",
        facebook: null,
        instagram: null,
        isDeleted: true,
        location: "",
        name: DELETED_MEMBER_NAME,
        tiktok: null,
        twitter: null,
        vimeo: null,
        website: null,
        youtube: null,
      },
      where: { id: photographerId },
    });
  }

  // 5. Their activity. Reviews they wrote about others stay, shown as
  //    "Deleted member": they are about the other member's work.
  await db.comment.deleteMany({ where: { userId } });
  await db.commentLike.deleteMany({ where: { userId } });
  await db.eventLike.deleteMany({ where: { userId } });
  await db.favorite.deleteMany({ where: { userId } });
  await db.swipe.deleteMany({ where: { OR: [{ swiperId: userId }, { targetId: userId }] } });
  await db.match.deleteMany({ where: { OR: [{ user1Id: userId }, { user2Id: userId }] } });
  await db.notification.deleteMany({ where: { recipientId: userId } });
  await db.threadRead.deleteMany({ where: { userId } });
  await db.profileView.deleteMany({ where: { userId } });

  // 6. Invites: their code stops working (others they invited keep their
  //    accounts); the record of their own invitation goes.
  await db.inviteCode.updateMany({ data: { maxRedemptions: 0 }, where: { creatorId: userId } });
  await db.inviteRedemption.deleteMany({ where: { redeemedById: userId } });

  // 7. Everything keyed on their email address, and sign-in.
  await db.waitlist.deleteMany({ where: { email: user.email } });
  await db.waitlist.updateMany({ data: { reviewedById: null }, where: { reviewedById: userId } });
  await db.pendingInviteValidation.deleteMany({ where: { email: user.email } });
  await db.verificationToken.deleteMany({ where: { identifier: otpIdentifier(user.email) } });
  await db.account.deleteMany({ where: { userId } });
  await db.session.deleteMany({ where: { userId } });

  // 8. Last: the account itself, anonymised. Messages they sent stay in
  //    the conversations of the people who received them, from "Deleted
  //    member". `stripeId` stays: Stripe keeps the billing records it must.
  const { count } = await db.user.updateMany({
    data: {
      address: null,
      budgetMax: null,
      budgetMin: null,
      city: null,
      country: null,
      deletedAt: now,
      email: deletedAccountEmail(userId),
      emailVerified: null,
      firstName: DELETED_MEMBER.firstName,
      handle: null,
      invitedByUserId: null,
      isDiscoverable: false,
      lastName: DELETED_MEMBER.lastName,
      phone: null,
      profilePic: null,
      role: "standard",
      seekingTypes: null,
      state: null,
      deletionSkipped: skipped.length > 0 ? skipped.join(",") : null,
      zip: null,
    },
    where: { deletedAt: null, id: userId, isDeleted: true },
  });
  if (count === 0) return "not-pending";

  for (const step of skipped) {
    // Grouped as one issue per step in error tracking; no user id is sent.
    captureServerException(new Error(`Account deletion step skipped: ${step}`), {
      extra: { $exception_fingerprint: `account-deletion-skipped:${step}`, step },
      source: "account-deletion",
    });
  }

  try {
    await deps.sendConfirmation({ email: user.email, firstName: user.firstName });
  } catch (error) {
    // The deletion is done either way; the address is gone, so this cannot
    // be retried.
    logger.error("Account deletion confirmation email failed", { error });
  }
  return "finished";
}
