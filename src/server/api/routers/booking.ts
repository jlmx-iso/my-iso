import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { logger } from "~/_utils";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { captureEvent } from "~/server/_lib/posthog";

export const bookingRouter = createTRPCRouter({
  applyToEvent: protectedProcedure
    .input(
      z.object({
        eventId: z.string().min(1),
        notes: z.string().max(500).optional(),
        platform: z.enum(['ios', 'web']).optional().default('web'),
        rate: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Look up the event to get the photographer's userId as ownerId
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
          message: "You have already applied to this event",
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
          logger.error("Error creating booking", { error: error as Error });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create booking",
          });
        });

      void captureEvent(userId, 'booking_requested', { photographer_id: ownerId, platform: input.platform ?? 'web' });

      return booking;
    }),

  getByEventId: protectedProcedure
    .input(z.object({ eventId: z.string().min(1) }))
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
        orderBy: { createdAt: "desc" },
        where: {
          eventId: input.eventId,
          isDeleted: false,
        },
      });
    }),

  getMyApplications: protectedProcedure.query(async ({ ctx }) => {
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
      orderBy: { createdAt: "desc" },
      where: {
        applicantId: userId,
        isDeleted: false,
      },
    });
  }),

  getReceivedApplications: protectedProcedure.query(async ({ ctx }) => {
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
      orderBy: { createdAt: "desc" },
      where: {
        isDeleted: false,
        ownerId: userId,
      },
    });
  }),

  hasApplied: protectedProcedure
    .input(z.object({ eventId: z.string().min(1) }))
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
        bookingId: z.string().min(1),
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
          logger.error("Error updating booking status", {
            error: error as Error,
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update booking status",
          });
        });
    }),
});
