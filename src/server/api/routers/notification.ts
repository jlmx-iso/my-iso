import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { logger } from "~/_utils";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const notificationRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        unreadOnly: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const where = {
        recipientId: userId,
        ...(input.unreadOnly ? { isRead: false } : {}),
      };

      const [notifications, totalCount, unreadCount] = await Promise.all([
        ctx.db.notification.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: input.limit,
          skip: input.offset,
        }),
        ctx.db.notification.count({ where }),
        ctx.db.notification.count({
          where: { recipientId: userId, isRead: false },
        }),
      ]);

      return {
        notifications,
        totalCount,
        unreadCount,
      };
    }),

  getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const count = await ctx.db.notification.count({
      where: { recipientId: userId, isRead: false },
    });
    return { count };
  }),

  markAsRead: protectedProcedure
    .input(z.object({ notificationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const notification = await ctx.db.notification.findUnique({
        where: { id: input.notificationId },
      });

      if (!notification) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notification not found",
        });
      }

      if (notification.recipientId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only mark your own notifications as read",
        });
      }

      const updated = await ctx.db.notification.update({
        where: { id: input.notificationId },
        data: { isRead: true },
      });

      logger.debug("Notification marked as read", {
        notificationId: input.notificationId,
        userId,
      });

      return updated;
    }),

  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const result = await ctx.db.notification.updateMany({
      where: { recipientId: userId, isRead: false },
      data: { isRead: true },
    });

    logger.debug("All notifications marked as read", {
      userId,
      count: result.count,
    });

    return { count: result.count };
  }),

  create: protectedProcedure
    .input(
      z.object({
        recipientId: z.string(),
        type: z.string(),
        title: z.string(),
        body: z.string(),
        linkUrl: z.string().optional(),
        data: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const notification = await ctx.db.notification.create({
        data: {
          recipientId: input.recipientId,
          type: input.type,
          title: input.title,
          body: input.body,
          linkUrl: input.linkUrl,
          data: input.data,
        },
      });

      logger.info("Notification created", {
        notificationId: notification.id,
        recipientId: input.recipientId,
        type: input.type,
      });

      return notification;
    }),
});
