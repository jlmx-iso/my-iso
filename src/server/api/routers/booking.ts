import { Prisma, type Booking } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { ErrorReason, logger } from "~/_utils";
import {
  actionFor,
  applyTransition,
  canReapply,
  checkTransition,
  isSlotTaken,
  REAPPLIABLE_CANCEL_ORIGIN,
  SLOT_HOLDING_STATUSES,
  type BookingAction,
  type TransitionRefusal,
} from "~/server/_db/bookingTransitions";
import { isUniqueViolation } from "~/server/_db/errors";
import { toPage } from "~/server/_db/pagination";
import type { ExtendedPrismaClient } from "~/server/_db/softDelete";
import { captureEvent } from "~/server/_lib/posthog";
import { RateLimits } from "~/server/_utils/rateLimit";
import { reasonedError } from "~/server/api/reasonedError";
import { createTRPCRouter, protectedProcedure, rateLimit } from "~/server/api/trpc";

const idInput = z.string().min(1).max(64);

const BOOKINGS_PAGE_SIZE = 100;

/** `limit` + `cursor` (id of the last booking of the previous page). */
const pageInput = z
  .object({
    cursor: idInput.optional(),
    limit: z.number().int().min(1).max(BOOKINGS_PAGE_SIZE).default(BOOKINGS_PAGE_SIZE),
  })
  .optional();

/** Newest first; `extra` rows beyond the page are for toPage. */
function page(input: z.infer<typeof pageInput>, extra: 0 | 1 = 0) {
  return {
    ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: (input?.limit ?? BOOKINGS_PAGE_SIZE) + extra,
  };
}

/**
 * Bookings are listed with their event's title, date and place. A booking
 * whose event has been deleted is left out: the include would otherwise
 * hand out a deleted event's details (the soft-delete extension does not
 * reach into includes).
 */
const onLiveEvent = { event: { isDeleted: false } } as const;

const bookingEventSelect = {
  date: true,
  // With `date`, lets the client tell whether the event has ended.
  duration: true,
  id: true,
  location: true,
  title: true,
} as const;

const bookingPartySelect = {
  firstName: true,
  id: true,
  lastName: true,
  profilePic: true,
} as const;

type BookingDb = Pick<ExtendedPrismaClient, "booking">;

/** Applications `userId` has sent, newest first. */
function findMyApplications(
  db: BookingDb,
  userId: string,
  input: z.infer<typeof pageInput>,
  extra: 0 | 1,
) {
  return db.booking.findMany({
    include: {
      event: { select: bookingEventSelect },
      owner: { select: bookingPartySelect },
    },
    ...page(input, extra),
    where: { applicantId: userId, ...onLiveEvent },
  });
}

/** Applications to `userId`'s events, newest first. */
function findReceivedApplications(
  db: BookingDb,
  userId: string,
  input: z.infer<typeof pageInput>,
  extra: 0 | 1,
) {
  return db.booking.findMany({
    include: {
      applicant: { select: bookingPartySelect },
      event: { select: bookingEventSelect },
    },
    ...page(input, extra),
    where: { ownerId: userId, ...onLiveEvent },
  });
}

/** An event stops accepting applications at its start time. */
const isInThePast = (date: Date) => date.getTime() < Date.now();

/** Why an event takes no applications right now (booking.hasApplied's `applyBlockedBy`). */
export type ApplyBlocker = "event_not_found" | "event_started" | "event_filled";

const ALREADY_APPLIED = "You have already applied to this event";

const eventFilled = () =>
  reasonedError(
    "CONFLICT",
    ErrorReason.BOOKING_EVENT_FILLED,
    "This event already has its second shooter.",
  );

const REFUSALS: Record<TransitionRefusal, () => TRPCError> = {
  event_started: () =>
    reasonedError(
      "BAD_REQUEST",
      ErrorReason.BOOKING_EVENT_STARTED,
      "This event has already started, so the booking can no longer be changed this way.",
    ),
  invalid_transition: () =>
    reasonedError(
      "CONFLICT",
      ErrorReason.BOOKING_INVALID_TRANSITION,
      "This booking has changed and can no longer be updated this way. Refresh to see its current status.",
    ),
  not_allowed: () =>
    reasonedError(
      "FORBIDDEN",
      ErrorReason.BOOKING_NOT_ALLOWED,
      "You are not allowed to do that with this booking.",
    ),
  not_yet_completable: () =>
    reasonedError(
      "BAD_REQUEST",
      ErrorReason.BOOKING_NOT_YET_COMPLETABLE,
      "A booking can be marked as completed once the event has taken place.",
    ),
};

type NotificationDb = Pick<ExtendedPrismaClient, "notification">;

/**
 * Tells the other party about a booking change, in the app. Never fails the
 * change that caused it: a lost notification is logged.
 */
async function notify(
  db: NotificationDb,
  notification: {
    body: string;
    bookingId: string;
    eventId: string;
    linkUrl: string;
    recipientId: string;
    title: string;
    type: string;
  },
): Promise<void> {
  const { bookingId, eventId, ...fields } = notification;
  try {
    await db.notification.create({
      data: { ...fields, data: JSON.stringify({ bookingId, eventId }) },
    });
  } catch (error) {
    logger.warn("Failed to create booking notification", { bookingId, error, type: fields.type });
  }
}

const displayName = (user: { firstName: string; lastName: string } | null) =>
  `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "Someone";

/** The in-app notification each action sends to the other party. */
function notificationFor(
  action: BookingAction,
  actorName: string,
  eventTitle: string,
): { body: string; title: string; type: string } {
  switch (action) {
    case "accept":
      return {
        body: `${actorName} accepted your application for "${eventTitle}".`,
        title: "Application accepted",
        type: "booking_accepted",
      };
    case "decline":
      return {
        body: `Your application for "${eventTitle}" was not accepted this time.`,
        title: "Application declined",
        type: "booking_declined",
      };
    case "withdraw":
      return {
        body: `${actorName} withdrew their application for "${eventTitle}".`,
        title: "Application withdrawn",
        type: "booking_canceled",
      };
    case "cancel":
      return {
        body: `${actorName} canceled the booking for "${eventTitle}".`,
        title: "Booking canceled",
        type: "booking_canceled",
      };
    case "complete":
      return {
        body: `${actorName} marked the booking for "${eventTitle}" as completed. You can now leave a review.`,
        title: "Booking completed",
        type: "booking_completed",
      };
  }
}

export const bookingRouter = createTRPCRouter({
  applyToEvent: protectedProcedure
    .use(rateLimit(RateLimits.BOOKING_APPLY))
    .input(
      z.object({
        eventId: idInput,
        notes: z.string().max(500).optional(),
        platform: z.enum(['ios', 'web']).optional().default('web'),
        rate: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Look up the event to get the photographer's userId as ownerId.
      // findUnique goes through the soft-delete extension, so a deleted
      // event is "not found" and cannot be applied to.
      const event = await ctx.db.event.findUnique({
        include: {
          photographer: {
            select: { userId: true },
          },
        },
        where: { id: input.eventId },
      });

      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      if (isInThePast(event.date)) {
        throw reasonedError(
          "BAD_REQUEST",
          ErrorReason.BOOKING_EVENT_STARTED,
          "This event has already taken place",
        );
      }

      const ownerId = event.photographer.userId;

      // Prevent self-application
      if (ownerId === userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot apply to your own event",
        });
      }

      // The early answer for the usual case. The write below makes the same
      // check again IN ITS OWN STATEMENT, so an application cannot slip in
      // between this read and that write while someone else is accepted.
      if (await isSlotTaken(ctx.db, event.id)) throw eventFilled();

      const applicationKey = { applicantId: userId, eventId: input.eventId };
      const slotIsOpen = {
        bookings: { none: { isDeleted: false, status: { in: [...SLOT_HOLDING_STATUSES] } } },
        isDeleted: false,
      };

      // Someone who WITHDREW their application may apply again: the same
      // row goes back to "applied" (one conditional statement, so a double
      // submit applies once). Nothing else is reopened: not an application
      // the owner declined, and not a booking that was accepted and then
      // cancelled by either side (cancelOrigin says which it was). Only the
      // applicant's own fields are rewritten; what the owner wrote stays.
      //
      // `createdAt` becomes now: it is "applied at", the time the lists sort
      // by (newest first) and the card shows. A new application must stand
      // among the new ones, where the owner who has just been notified
      // looks for it, not where the withdrawn one was months ago.
      const reapplied = await ctx.db.booking.updateMany({
        data: {
          cancelOrigin: null,
          createdAt: new Date(),
          notes: input.notes ?? null,
          rate: input.rate ?? null,
          status: "applied",
        },
        where: {
          ...applicationKey,
          cancelOrigin: REAPPLIABLE_CANCEL_ORIGIN,
          event: slotIsOpen,
          isDeleted: false,
          status: "canceled",
        },
      });

      let booking: Booking;
      if (reapplied.count > 0) {
        booking = await ctx.db.booking.findUniqueOrThrow({
          where: { eventId_applicantId: applicationKey },
        });
      } else {
        // A first application: inserted only if the slot is still open, in
        // one statement (INSERT ... SELECT ... WHERE NOT EXISTS). An
        // application that exists already makes it insert nothing too (the
        // unique (eventId, applicantId)); the two are told apart below.
        //
        // The answer is built from what this statement wrote, not read back:
        // once the insert has committed, a read that failed would report a
        // failure for an application that exists, skip the owner's
        // notification, and leave a retry to be told "already applied".
        const now = new Date();
        const created: Booking = {
          applicantId: userId,
          cancelOrigin: null,
          createdAt: now,
          eventId: event.id,
          id: crypto.randomUUID(),
          isDeleted: false,
          notes: input.notes ?? null,
          ownerId,
          ownerNotes: null,
          rate: input.rate ?? null,
          status: "applied",
          updatedAt: now,
        };
        const inserted = await ctx.db
          .$queryRaw<Array<{ id: string }>>(
            Prisma.sql`
            INSERT INTO "Booking"
              ("id", "createdAt", "updatedAt", "eventId", "applicantId", "ownerId", "status", "rate", "notes", "isDeleted")
            SELECT ${created.id}, ${created.createdAt}, ${created.updatedAt}, ${created.eventId}, ${created.applicantId},
              ${created.ownerId}, ${created.status}, ${created.rate}, ${created.notes}, false
            WHERE NOT EXISTS (
              SELECT 1 FROM "Booking" held
              WHERE held."eventId" = ${event.id} AND NOT held."isDeleted"
                AND held."status" IN (${Prisma.join([...SLOT_HOLDING_STATUSES])})
            )
            ON CONFLICT ("eventId", "applicantId") DO NOTHING
            RETURNING "id"`,
          )
          .catch((error: unknown) => {
            if (isUniqueViolation(error)) return [];
            logger.error("Error creating booking", { error });
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to create booking",
            });
          });

        if (inserted[0]?.id !== created.id) {
          // Nothing was written, by this statement or the re-open above.
          // Either the slot went to someone else in the meantime, or an
          // application is on record that cannot be sent again.
          if (await isSlotTaken(ctx.db, event.id)) throw eventFilled();
          throw new TRPCError({ code: "CONFLICT", message: ALREADY_APPLIED });
        }
        booking = created;
      }

      const applicant = await ctx.db.user.findUnique({
        select: { firstName: true, lastName: true },
        where: { id: userId },
      });
      await notify(ctx.db, {
        body: `${displayName(applicant)} applied to "${event.title}".`,
        bookingId: booking.id,
        eventId: event.id,
        linkUrl: "/app/bookings",
        recipientId: ownerId,
        title: "New application",
        type: "booking_applied",
      });

      void captureEvent(userId, 'booking_requested', { photographer_id: ownerId, platform: input.platform ?? 'web' });

      return booking;
    }),

  getByEventId: protectedProcedure
    .input(z.object({
      cursor: idInput.optional(),
      eventId: idInput,
      limit: z.number().int().min(1).max(BOOKINGS_PAGE_SIZE).default(BOOKINGS_PAGE_SIZE),
    }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify the current user owns this event
      const event = await ctx.db.event.findUnique({
        include: {
          photographer: {
            select: { userId: true },
          },
        },
        where: { id: input.eventId },
      });

      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      if (event.photographer.userId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only view applications for your own events",
        });
      }

      // The event was just loaded through the soft-delete filter, so it is live.
      return ctx.db.booking.findMany({
        include: {
          applicant: { select: bookingPartySelect },
          event: { select: bookingEventSelect },
        },
        ...page(input),
        where: {
          eventId: input.eventId,
        },
      });
    }),

  /**
   * The caller's applications, newest first, as a plain array (`cursor` is
   * the id of the last booking received). getMyApplicationsPage returns the
   * same as `{ items, nextCursor }`.
   */
  getMyApplications: protectedProcedure
    .input(pageInput)
    .query(({ ctx, input }) => findMyApplications(ctx.db, ctx.session.user.id, input, 0)),

  getMyApplicationsPage: protectedProcedure.input(pageInput).query(async ({ ctx, input }) => {
    const rows = await findMyApplications(ctx.db, ctx.session.user.id, input, 1);
    return toPage(rows, input?.limit ?? BOOKINGS_PAGE_SIZE);
  }),

  /**
   * Applications to the caller's events, newest first, as a plain array.
   * getReceivedApplicationsPage returns the same as `{ items, nextCursor }`.
   */
  getReceivedApplications: protectedProcedure
    .input(pageInput)
    .query(({ ctx, input }) => findReceivedApplications(ctx.db, ctx.session.user.id, input, 0)),

  getReceivedApplicationsPage: protectedProcedure.input(pageInput).query(async ({ ctx, input }) => {
    const rows = await findReceivedApplications(ctx.db, ctx.session.user.id, input, 1);
    return toPage(rows, input?.limit ?? BOOKINGS_PAGE_SIZE);
  }),

  hasApplied: protectedProcedure
    .input(z.object({ eventId: idInput }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const booking = await ctx.db.booking.findUnique({
        where: {
          eventId_applicantId: {
            applicantId: userId,
            eventId: input.eventId,
          },
        },
      });

      // What `applyToEvent` would say about the EVENT right now, whoever
      // asks: it has started, or its slot is taken. An application (first
      // or again) is only worth offering when this is null.
      const event = await ctx.db.event.findUnique({ select: { date: true, id: true }, where: { id: input.eventId } });
      const applyBlockedBy: ApplyBlocker | null = !event
        ? "event_not_found"
        : isInThePast(event.date)
          ? "event_started"
          : (await isSlotTaken(ctx.db, event.id))
            ? "event_filled"
            : null;

      // `hasApplied` is true for any application on record, whatever became
      // of it. `canReapply`: it was withdrawn, so the booking itself allows
      // a new application (show "Apply again", not a disabled "Applied"),
      // provided the event still takes applications (`applyBlockedBy`).
      return {
        applyBlockedBy,
        canReapply: booking ? canReapply(booking) : false,
        hasApplied: !!booking,
        status: booking?.status ?? null,
      };
    }),

  /**
   * Moves a booking to `status`, if the booking's state, the caller's role
   * and the event's date allow it (see ~/server/_db/bookingTransitions):
   *
   * - `accepted`, `declined`: the event owner, on an application.
   * - `canceled`: the applicant withdrawing an application, or either party
   *   cancelling an accepted booking before the event.
   * - `completed`: either party, on an accepted booking, once the event has
   *   ended (its start plus its duration).
   *
   * `ownerNotes` may only be sent by the event owner.
   *
   * Errors (reason in `error.data.reason`):
   * - NOT_FOUND: no such booking, or the caller is not part of it.
   * - FORBIDDEN `booking_not_allowed`: wrong role for this change.
   * - CONFLICT `booking_invalid_transition`: the booking is not (or no
   *   longer) in a state that allows it; refetch.
   * - CONFLICT `booking_event_filled`: another applicant was accepted.
   * - BAD_REQUEST `booking_event_started` / `booking_not_yet_completable`.
   */
  updateStatus: protectedProcedure
    .use(rateLimit(RateLimits.BOOKING_UPDATE))
    .input(
      z.object({
        bookingId: idInput,
        ownerNotes: z.string().trim().max(500).optional(),
        status: z.enum([
          "accepted",
          "declined",
          "completed",
          "canceled",
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const booking = await ctx.db.booking.findFirst({
        include: { event: { select: { date: true, duration: true, id: true, title: true } } },
        where: { id: input.bookingId, ...onLiveEvent },
      });

      // Someone who is not part of the booking learns nothing about it.
      if (!booking || (booking.ownerId !== userId && booking.applicantId !== userId)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found",
        });
      }

      const role = booking.ownerId === userId ? "owner" : "applicant";
      const action = actionFor(input.status, booking.status);

      // The owner's reply is the owner's to write.
      if (input.ownerNotes !== undefined && role !== "owner") throw REFUSALS.not_allowed();

      const refusal = checkTransition(action, role, booking, booking.event, new Date());
      if (refusal) throw REFUSALS[refusal]();

      const applied = await applyTransition(ctx.db, booking.id, action, role, {
        ownerNotes: input.ownerNotes,
      }).catch((error: unknown) => {
        logger.error("Error updating booking status", { error });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update booking status",
        });
      });

      if (!applied) {
        // The booking moved between the read and the write (the other party
        // was quicker), or, for an accept, the slot went to someone else.
        if (action === "accept" && (await isSlotTaken(ctx.db, booking.eventId, booking.id))) {
          throw eventFilled();
        }
        throw REFUSALS.invalid_transition();
      }

      const actor = await ctx.db.user.findUnique({
        select: { firstName: true, lastName: true },
        where: { id: userId },
      });
      await notify(ctx.db, {
        ...notificationFor(action, displayName(actor), booking.event.title),
        bookingId: booking.id,
        eventId: booking.eventId,
        linkUrl: "/app/bookings",
        recipientId: role === "owner" ? booking.applicantId : booking.ownerId,
      });

      return ctx.db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    }),
});
