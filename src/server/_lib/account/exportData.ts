// "Download your data": everything ISO stores about a member, as one JSON
// document, generated on request (Settings, account.exportData).
//
// EXPORT_COVERAGE says, for every model in prisma/schema.prisma, where its
// rows appear in the export or why they do not. exportData.test.ts fails
// when a model is added without an entry here.

import type { ConsentState } from "~/_lib/consent";
import {
  type ExtendedPrismaClient,
  INCLUDING_DELETED,
} from "~/server/_db/softDelete";

export const EXPORT_FORMAT = "iso-account-export";
export const EXPORT_VERSION = 1;

type Coverage = { exportedAs: string } | { excluded: string };

/** Every model, and where it goes in the export (or why it does not). */
export const EXPORT_COVERAGE: Record<string, Coverage> = {
  Account: { exportedAs: "signInMethods" },
  BillingLease: {
    excluded:
      "A lock held for a few seconds while starting Checkout; holds no personal data.",
  },
  Booking: { exportedAs: "bookings" },
  Comment: { exportedAs: "eventComments" },
  CommentLike: { exportedAs: "likes.comments" },
  Event: { exportedAs: "events" },
  EventView: { exportedAs: "insights.eventViews" },
  EventLike: { exportedAs: "likes.events" },
  Example: { excluded: "Unused scaffold table; never written." },
  Favorite: { exportedAs: "favorites" },
  InviteCode: { exportedAs: "invites.code" },
  InviteRedemption: { exportedAs: "invites.redeemed" },
  Match: { exportedAs: "discover.matches" },
  Message: { exportedAs: "messages.sent" },
  MessageThread: { exportedAs: "messages.threads" },
  Notification: { exportedAs: "notifications" },
  PendingInviteValidation: {
    excluded:
      "Short-lived sign-up state (an invite code checked for an address); deleted when it expires.",
  },
  Photographer: { exportedAs: "profile" },
  PortfolioImage: { exportedAs: "portfolio" },
  ProfileView: { exportedAs: "insights.profileViews" },
  RateLimit: {
    excluded:
      "Counters keyed by a one-way hash; cannot be tied back to the member and expire within a day.",
  },
  Review: { exportedAs: "reviews" },
  Session: {
    excluded:
      "Secret session tokens; sign-in uses signed cookies and this table is not written.",
  },
  StripeEvent: {
    excluded:
      "Stripe webhook event ids, kept to ignore repeats; no personal data.",
  },
  Subscription: { exportedAs: "subscription" },
  SubscriptionDispute: {
    excluded:
      "Chargeback bookkeeping by Stripe id; the dispute itself is between the member, their bank and Stripe.",
  },
  Swipe: { exportedAs: "discover.swipes" },
  ThreadRead: { exportedAs: "messages.readState" },
  User: { exportedAs: "account" },
  ViewSeen: {
    excluded: "One-way keyed hashes used to count a view once a day, deleted daily; they cannot be listed by member.",
  },
  VerificationToken: {
    excluded: "Secret one-time sign-in codes that expire within minutes.",
  },
  Waitlist: { exportedAs: "waitlist" },
};

export type ExportDb = Pick<
  ExtendedPrismaClient,
  | "account"
  | "booking"
  | "comment"
  | "commentLike"
  | "event"
  | "eventView"
  | "eventLike"
  | "favorite"
  | "inviteCode"
  | "inviteRedemption"
  | "match"
  | "message"
  | "messageThread"
  | "notification"
  | "photographer"
  | "portfolioImage"
  | "review"
  | "subscription"
  | "swipe"
  | "threadRead"
  | "profileView"
  | "user"
  | "waitlist"
>;

const personSelect = { firstName: true, id: true, lastName: true } as const;

/**
 * Rows per query for reads that load relations: Prisma loads a relation
 * with an `IN (...)` list of the parent ids, and D1 allows about 100 bound
 * parameters (CLAUDE.md), so such a read takes at most this many at a time.
 */
export const EXPORT_PAGE = 80;

/** Reads every row through `read`, EXPORT_PAGE at a time. */
async function inPages<T>(
  read: (page: { skip: number; take: number }) => Promise<T[]>
): Promise<T[]> {
  const rows: T[] = [];
  for (let skip = 0; ; skip += EXPORT_PAGE) {
    const page = await read({ skip, take: EXPORT_PAGE });
    rows.push(...page);
    if (page.length < EXPORT_PAGE) return rows;
  }
}

export type ExportLimits = { notifications: number; sentMessages: number };

/**
 * The export holds at most this many of the two lists that grow without
 * bound: the latest sent messages and notifications. The file says when a
 * list was cut (`sentTruncated`, `notificationsTruncated`); the rest is
 * available on request (privacy policy).
 */
export const EXPORT_LIMITS: ExportLimits = {
  notifications: 2000,
  sentMessages: 5000,
};

function parseJsonList(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * Builds the export for `userId`. Throws if the account does not exist.
 *
 * What it holds about other people is only what the member already sees in
 * the app: names and ids of the people in their conversations, bookings,
 * matches and reviews. Messages are the member's own; the other side of a
 * conversation stays readable in the app.
 */
export async function buildAccountExport(
  db: ExportDb,
  userId: string,
  options: {
    consent: { choice: ConsentState; optInRegion: boolean };
    limits?: ExportLimits;
    now?: Date;
  }
) {
  const limits = options.limits ?? EXPORT_LIMITS;
  const user = await db.user.findUniqueOrThrow({
    select: {
      address: true,
      budgetMax: true,
      budgetMin: true,
      city: true,
      country: true,
      createdAt: true,
      email: true,
      emailVerified: true,
      firstName: true,
      handle: true,
      id: true,
      invitedBy: { select: personSelect },
      isDiscoverable: true,
      lastName: true,
      phone: true,
      profilePic: true,
      role: true,
      seekingTypes: true,
      state: true,
      stripeId: true,
      updatedAt: true,
      zip: true,
    },
    where: { id: userId },
  });

  const profile = await db.photographer.findFirst({
    select: {
      avatar: true,
      bio: true,
      companyName: true,
      createdAt: true,
      facebook: true,
      id: true,
      instagram: true,
      location: true,
      name: true,
      tiktok: true,
      twitter: true,
      updatedAt: true,
      vimeo: true,
      website: true,
      youtube: true,
    },
    where: { ...INCLUDING_DELETED, userId },
  });
  const photographerId = profile?.id ?? null;

  const [
    signInMethods,
    portfolio,
    events,
    eventComments,
    eventLikes,
    commentLikes,
    favorites,
    bookingsAsApplicant,
    bookingsAsOwner,
    reviewsWritten,
    reviewsReceived,
    threads,
    sent,
    readState,
    notifications,
    swipes,
    matches,
    subscription,
    inviteCode,
    redeemed,
    waitlist,
    profileViews,
    eventViews,
  ] = await Promise.all([
    db.account.findMany({
      select: { provider: true, type: true },
      where: { userId },
    }),
    photographerId
      ? db.portfolioImage.findMany({
          orderBy: { sortOrder: "asc" },
          select: {
            createdAt: true,
            description: true,
            id: true,
            image: true,
            isDeleted: true,
            isFeatured: true,
            sortOrder: true,
            tags: true,
            title: true,
          },
          where: { ...INCLUDING_DELETED, photographerId },
        })
      : [],
    photographerId
      ? db.event.findMany({
          orderBy: { date: "asc" },
          select: {
            createdAt: true,
            date: true,
            description: true,
            duration: true,
            id: true,
            image: true,
            isDeleted: true,
            location: true,
            title: true,
          },
          where: { ...INCLUDING_DELETED, photographerId },
        })
      : [],
    db.comment.findMany({
      select: {
        content: true,
        createdAt: true,
        eventId: true,
        id: true,
        isDeleted: true,
      },
      where: { ...INCLUDING_DELETED, userId },
    }),
    db.eventLike.findMany({
      select: { createdAt: true, eventId: true },
      where: { isDeleted: false, userId },
    }),
    db.commentLike.findMany({
      select: { commentId: true, createdAt: true },
      where: { isDeleted: false, userId },
    }),
    db.favorite.findMany({
      select: { createdAt: true, targetId: true },
      where: { userId },
    }),
    inPages((page) =>
      db.booking.findMany({
        ...page,
        orderBy: { id: "asc" },
        select: {
          createdAt: true,
          event: { select: { date: true, id: true, title: true } },
          id: true,
          notes: true,
          owner: { select: personSelect },
          ownerNotes: true,
          rate: true,
          status: true,
          updatedAt: true,
        },
        where: { ...INCLUDING_DELETED, applicantId: userId },
      })
    ),
    inPages((page) =>
      db.booking.findMany({
        ...page,
        orderBy: { id: "asc" },
        select: {
          applicant: { select: personSelect },
          createdAt: true,
          event: { select: { date: true, id: true, title: true } },
          id: true,
          notes: true,
          ownerNotes: true,
          rate: true,
          status: true,
          updatedAt: true,
        },
        where: { ...INCLUDING_DELETED, ownerId: userId },
      })
    ),
    inPages((page) =>
      db.review.findMany({
        ...page,
        orderBy: { id: "asc" },
        select: {
          createdAt: true,
          description: true,
          id: true,
          photographer: { select: { id: true, name: true } },
          rating: true,
          title: true,
        },
        where: { userId },
      })
    ),
    photographerId
      ? inPages((page) =>
          db.review.findMany({
            ...page,
            orderBy: { id: "asc" },
            select: {
              createdAt: true,
              description: true,
              id: true,
              rating: true,
              title: true,
              user: { select: personSelect },
            },
            where: { photographerId },
          })
        )
      : [],
    inPages((page) =>
      db.messageThread.findMany({
        ...page,
        orderBy: { id: "asc" },
        select: {
          createdAt: true,
          id: true,
          participants: { select: personSelect },
        },
        where: { participants: { some: { id: userId } } },
      })
    ),
    db.message.findMany({
      // The latest ones, oldest first once reversed below.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        content: true,
        createdAt: true,
        id: true,
        isDeleted: true,
        threadId: true,
      },
      take: limits.sentMessages + 1,
      where: { ...INCLUDING_DELETED, senderId: userId },
    }),
    db.threadRead.findMany({
      select: { lastReadAt: true, threadId: true },
      where: { userId },
    }),
    db.notification.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limits.notifications + 1,
      select: {
        body: true,
        createdAt: true,
        id: true,
        isRead: true,
        linkUrl: true,
        title: true,
        type: true,
      },
      where: { recipientId: userId },
    }),
    db.swipe.findMany({
      select: { createdAt: true, direction: true, targetId: true },
      where: { swiperId: userId },
    }),
    inPages((page) =>
      db.match.findMany({
        ...page,
        orderBy: { id: "asc" },
        select: {
          aiSummary: true,
          createdAt: true,
          expiresAt: true,
          icebreakers: true,
          id: true,
          status: true,
          user1: { select: personSelect },
          user2: { select: personSelect },
        },
        where: { OR: [{ user1Id: userId }, { user2Id: userId }] },
      })
    ),
    db.subscription.findUnique({
      select: {
        cancelAt: true,
        cancelAtPeriodEnd: true,
        createdAt: true,
        currentPeriodEnd: true,
        currentPeriodStart: true,
        endedAt: true,
        interval: true,
        isLifetime: true,
        plan: true,
        status: true,
      },
      where: { userId },
    }),
    db.inviteCode.findUnique({
      select: {
        code: true,
        createdAt: true,
        currentRedemptions: true,
        maxRedemptions: true,
      },
      where: { creatorId: userId },
    }),
    db.inviteRedemption.findUnique({
      select: { inviteCode: { select: { code: true } }, redeemedAt: true },
      where: { redeemedById: userId },
    }),
    db.waitlist.findUnique({
      select: {
        createdAt: true,
        instagram: true,
        name: true,
        referralSource: true,
        status: true,
        userType: true,
        website: true,
      },
      where: { email: user.email },
    }),
    db.profileView.findMany({
      orderBy: [{ day: "asc" }, { source: "asc" }],
      select: { count: true, day: true, source: true },
      where: { userId },
    }),
    photographerId
      ? db.eventView.findMany({
          orderBy: [{ day: "asc" }, { eventId: "asc" }],
          select: { count: true, day: true, eventId: true },
          where: { event: { photographerId } },
        })
      : [],
  ]);

  const images = [
    user.profilePic,
    profile?.avatar ?? null,
    ...portfolio.map((row) => row.image),
    ...events.map((row) => row.image),
  ].filter((url): url is string => typeof url === "string" && url.length > 0);

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    account: { ...user, seekingTypes: parseJsonList(user.seekingTypes) },
    signInMethods,
    profile,
    portfolio: portfolio.map((row) => ({
      ...row,
      tags: parseJsonList(row.tags),
    })),
    events,
    eventComments,
    likes: { comments: commentLikes, events: eventLikes },
    favorites,
    bookings: { asApplicant: bookingsAsApplicant, asOwner: bookingsAsOwner },
    reviews: { received: reviewsReceived, written: reviewsWritten },
    messages: {
      readState,
      // Oldest first; at most limits.sentMessages, the latest ones.
      sent: sent.slice(0, limits.sentMessages).reverse(),
      sentTruncated: sent.length > limits.sentMessages,
      threads,
    },
    notifications: notifications.slice(0, limits.notifications).reverse(),
    notificationsTruncated: notifications.length > limits.notifications,
    limits,
    discover: {
      matches: matches.map((match) => ({
        ...match,
        icebreakers: parseJsonList(match.icebreakers),
      })),
      swipes,
    },
    // A summary: card details are held by Stripe, never by ISO.
    subscription,
    invites: { code: inviteCode, redeemed },
    waitlist,
    // Pro insights: daily view counts of their profile and events (nothing
    // about who viewed).
    insights: { eventViews, profileViews },
    consent: options.consent,
    // Every uploaded image, so they can be saved before an account is deleted.
    images: [...new Set(images)],
  };
}

export type AccountExport = Awaited<ReturnType<typeof buildAccountExport>>;
