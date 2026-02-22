import { z } from "zod";

import { logger } from "~/_utils";
import { createTRPCRouter, protectedProcedure, } from "~/server/api/trpc";

export const eventRouter = createTRPCRouter({
  addCommentToEvent: protectedProcedure
    .input(z.object({
      content: z.string().min(1),
      eventId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      return ctx.db.event.update({
        data: {
          comments: {
            create: {
              content: input.content,
              userId,
            },
          },
        },
        where: { id: input.eventId },
      });
    }),

  addLikeToEvent: protectedProcedure
    .input(z.object({
      targetId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      return ctx.db.event.update({
        data: {
          eventLikes: {
            create: {
              userId,
            },
          },
        },
        where: { id: input.targetId },
      });
    }),

  addOrRemoveEventCommentLike: protectedProcedure
    .input(z.object({
      targetId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const commentLike = await ctx.db.commentLike.findFirst({
        where: {
          commentId: input.targetId,
          userId,
        }
      }).catch((error: unknown) => {
        logger.error("Error checking for existing comment like", { error: error as Error });
        throw new Error("Error checking for existing comment like");
      });

      if (!commentLike) {
        return ctx.db.comment.update({
          data: {
            commentLikes: {
              create: {
                userId,
              },
            }
          },
          where: { id: input.targetId }
        }).catch((error: unknown) => {
          logger.error("Error creating comment like", { error: error as Error });
          throw new Error("Error creating comment like");
        });
      }

      return ctx.db.commentLike.update({
        data: {
          isDeleted: !commentLike.isDeleted,
        },
        where: { id: commentLike.id }
      }).catch((error: unknown) => {
        logger.error("Error adding comment like", { error: error as Error });
        throw new Error("Error adding comment like");
      });
    }),

  create: protectedProcedure
    .input(z.object({
      date: z.string().min(1),
      description: z.string().min(1),
      duration: z.number().min(1),
      image: z.string().optional(),
      location: z.string().min(1),
      title: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      // Get photographerId
      const photographerId = await ctx.db.photographer.findUnique(
        {
          select: { id: true },
          where: { userId: ctx.session.user.id }
        })
        .then((photographer) => {
          if (!photographer) {
            throw new Error("Photographer not found");
          }
          return photographer.id;
        });

      if (input.image) {
        const result = await ctx.cloudinaryClient.upload(input.image, `/app/${photographerId}/events`)
          .catch((error: unknown) => {
            logger.error("Error uploading image", { error: error as Error });
            throw new Error("Error uploading image");
          });

        if (result.isErr) {
          logger.error("Error uploading image", { error: result.error });
          throw new Error("Error uploading image");
        }

        logger.info("Image uploaded", { url: result.value?.secure_url });
        input.image = result.value?.secure_url;
      }


      return ctx.db.event.create({
        data: { ...input, photographerId },
      }).catch((error: unknown) => {
        logger.error("Error creating event", { error: error as Error });
        if (error instanceof Error) {
          throw error;
        }
        throw new Error("Error creating event");
      })
    }),

  delete: protectedProcedure
    .input(z.object({
      id: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.event.update({
        data: { isDeleted: true },
        where: {
          id: input.id,
          photographer: { userId: ctx.session.user.id },
        },
      });
    }),

  deleteCommentFromEvent: protectedProcedure
    .input(z.object({
      id: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.comment.delete({
        where: { id: input.id, userId: ctx.session.user.id },
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.event.findFirst({
        include: {
          photographer: {
            select: {
              avatar: true,
              name: true,
              userId: true,
            },
          }
        },
        where: { id: input.id, isDeleted: false },
      }).catch((error: unknown) => {
        logger.error("Error getting event", { error: error as Error });
        throw new Error("Error getting event");
      });

      if (!event) {
        throw new Error("Event not found");
      }

      const commentCount = await ctx.db.comment.count({
        where: { eventId: event.id },
      });

      return { ...event, commentCount };
    }),

  getByPhotographerId: protectedProcedure
    .input(z.object({ photographerId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.db.event.findMany({
        where: { photographerId: input.photographerId, isDeleted: false },
      });
    }),

  getCommentById: protectedProcedure
    .input(z.object({
      id: z.string().min(1),
    }))
    .query(async ({ ctx, input }) => {
      return ctx.db.comment.findFirst({
        include: {
          commentLikes: {
            include: {
              user: {
                select: {
                  id: true,
                },
              },
            },
            where: {
              isDeleted: false,
            }
          },
          user: {
            select: {
              firstName: true,
              lastName: true,
              profilePic: true,
            },
          },
        },
        where: { id: input.id },
      }).then((comment) => {
        if (!comment) {
          throw new Error("Comment not found");
        }

        return { ...comment, commentLikes: comment.commentLikes.length, isLiked: comment.commentLikes.some((like) => like.userId === ctx.session.user.id) };
      }).catch((error: unknown) => {
        logger.error("Error getting comment", { error: error as Error });
        throw new Error("Error getting comment");
      });
    }),

  getCommentCountByEventId: protectedProcedure
    .input(z.object({
      eventId: z.string().min(1),
    }))
    .query(async ({ ctx, input }) => {
      return ctx.db.comment.count({
        where: { eventId: input.eventId },
      });
    }),

  getCommentsByEventId: protectedProcedure
    .input(z.object({
      eventId: z.string().min(1),
    }))
    .query(async ({ ctx, input }) => {
      const comments = await ctx.db.comment.findMany({
        include: {
          commentLikes: {
            include: {
              user: {
                select: {
                  id: true,
                },
              },
            },
            where: {
              isDeleted: false,
            }
          },
          user: {
            select: {
              firstName: true,
              lastName: true,
              profilePic: true,
            },
          },
        },
        where: { eventId: input.eventId },
      }).catch((error: unknown) => {
        logger.error("Error getting comments", { error: error as Error });
        throw new Error("Error getting comments");
      });

      return comments.map((comment) => {
        return { ...comment, commentLikes: comment.commentLikes.length, isLiked: comment.commentLikes.some((like) => like.userId === ctx.session.user.id) };
      });
    }),

  getRecentByLocation: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).optional(),
      locations: z.array(z.string().min(1)),
      startAt: z.number().min(0).optional(),
    }))
    .query(({ ctx, input }) => {
      // Extract city names from location strings for fuzzy matching
      // e.g. "Austin, TX, USA" → "Austin" so it matches "Austin, TX"
      const locationFilters = input.locations
        .map((loc) => loc.split(",")[0]?.trim())
        .filter(Boolean)
        .map((city) => ({ location: { contains: city } }));

      return ctx.db.event.findMany({
        include: {
          photographer: {
            select: {
              avatar: true,
              name: true,
              userId: true,
            },
          },
        },
        orderBy: { date: 'desc' },
        skip: input.startAt ?? 0,
        take: input.limit ?? 10,
        where: {
          isDeleted: false,
          ...(locationFilters.length > 0
            ? { OR: locationFilters }
            : {}),
        },
      });
    }),

  search: protectedProcedure
    .input(z.object({
      afterDate: z.date(),
      beforeDate: z.date(),
      query: z.string().min(1),
    }))
    .query(({ ctx, input }) => {
      return ctx.db.event.findMany({
        where: {
          isDeleted: false,
          date: { gte: input.afterDate, lte: input.beforeDate },
          OR: [
            { title: { contains: input.query } },
            { description: { contains: input.query } },
            { location: { contains: input.query } },
          ],
        },
        take: 50,
      });
    }),

  update: protectedProcedure
    .input(z.object({
      date: z.string().min(1).optional(),
      description: z.string().min(1).optional(),
      duration: z.number().min(1).optional(),
      id: z.string().min(1),
      image: z.string().min(1).optional(),
      location: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return ctx.db.event.update({
        data,
        where: {
          id,
          photographer: { userId: ctx.session.user.id },
        },
      });
    }),
});