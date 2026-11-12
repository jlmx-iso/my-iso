import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { logger } from "~/_utils";
import { isUniqueViolation } from "~/server/_db/errors";
import { captureEvent } from "~/server/_lib/posthog";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const idInput = z.string().min(1).max(64);

const BOOKINGS_PAGE_SIZE = 100;

/** `limit` + `cursor` (id of the last booking of the previous page). */
const pageInput = z
  .object({
    cursor: idInput.optional(),
    limit: z.number().int().min(1).max(BOOKINGS_PAGE_SIZE).default(BOOKINGS_PAGE_SIZE),
  })
  .optional();

function page(input: z.infer<typeof pageInput>) {
  return {
    ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: input?.limit ?? BOOKINGS_PAGE_SIZE,
  };
}

const ALREADY_APPLIED = "You have already applied to this event";

export const bookingRouter = createTRPCRouter({
  applyToEvent: protectedProcedure
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

      const ownerId = event.photographer.userId;

      // Prevent self-application
      if (ownerId === userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot apply to your own event",
        });
      }

      // Check for existing application (the unique constraint will also catch this,
      // but a friendly error message is better)
      const existingBooking = await ctx.db.booking.findUnique({
        where: {
          eventId_applicantId: {
            applicantId: userId,
            eventId: input.eventId,
          },
        },
      });

      if (existingBooking) {
        throw new TRPCError({
          code: "CONFLICT",
          message: ALREADY_APPLIED,
        });
      }

      const booking = await ctx.db.booking
        .create({
          data: {
            applicantId: userId,
            eventId: input.eventId,
            notes: input.notes,
            ownerId,
            rate: input.rate,
          },
        })
        .catch((error: unknown) => {
          // Two submits at once: the unique (eventId, applicantId) rejects
          // the second, which is a conflict rather than a server fault.
          if (isUniqueViolation(error)) {
            throw new TRPCError({ code: "CONFLICT", message: ALREADY_APPLIED });
          }
          logger.error("Error creating booking", { error });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create booking",
          });
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

      return ctx.db.booking.findMany({
        include: {
          applicant: {
            select: {
              firstName: true,
              id: true,
              lastName: true,
              profilePic: true,
            },
          },
          event: {
            select: {
              date: true,
              id: true,
              location: true,
              title: true,
            },
          },
        },
        ...page(input),
        where: {
          eventId: input.eventId,
        },
      });
    }),

  getMyApplications: protectedProcedure.input(pageInput).query(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;

    return ctx.db.booking.findMany({
      include: {
        event: {
          select: {
            date: true,
            id: true,
            location: true,
            title: true,
          },
        },
        owner: {
          select: {
            firstName: true,
            id: true,
            lastName: true,
            profilePic: true,
          },
        },
      },
      ...page(input),
      where: {
        applicantId: userId,
      },
    });
  }),

  getReceivedApplications: protectedProcedure.input(pageInput).query(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;

    return ctx.db.booking.findMany({
      include: {
        applicant: {
          select: {
            firstName: true,
            id: true,
            lastName: true,
            profilePic: true,
          },
        },
        event: {
          select: {
            date: true,
            id: true,
            location: true,
            title: true,
          },
        },
      },
      ...page(input),
      where: {
        ownerId: userId,
      },
    });
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

      return { hasApplied: !!booking, status: booking?.status ?? null };
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        bookingId: idInput,
        ownerNotes: z.string().max(500).optional(),
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

      const booking = await ctx.db.booking.findUnique({
        where: { id: input.bookingId },
      });

      if (!booking) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found",
        });
      }

      // Authorization: Only the owner can accept/decline
      if (
        (input.status === "accepted" || input.status === "declined") &&
        booking.ownerId !== userId
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the event owner can accept or decline applications",
        });
      }

      // Authorization: Only the applicant can cancel
      if (input.status === "canceled" && booking.applicantId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the applicant can cancel their application",
        });
      }

      // Authorization: Either party can mark as completed
      if (
        input.status === "completed" &&
        booking.ownerId !== userId &&
        booking.applicantId !== userId
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the owner or applicant can mark a booking as completed",
        });
      }

      return ctx.db.booking
        .update({
          data: {
            ownerNotes: input.ownerNotes,
            status: input.status,
          },
          where: { id: input.bookingId },
        })
        .catch((error: unknown) => {
          logger.error("Error updating booking status", { error });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update booking status",
          });
        });
    }),
});
