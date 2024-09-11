import { z } from "zod";
import { logger } from "~/_utils";
import { createTRPCRouter, protectedProcedure, } from "~/server/api/trpc";

export const eventRouter = createTRPCRouter({
  getByPhotographerId: protectedProcedure
    .input(z.object({ photographerId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.db.event.findMany({
        where: { photographerId: input.photographerId },
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.event.findFirst({
        where: { id: input.id },
        include: {
          photographer: {
            select: {
              avatar: true,
              name: true,
              userId: true,
            },
          }
        },
      }).catch((error) => {
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

  getRecentByLocation: protectedProcedure
    .input(z.object({
      locations: z.array(z.string().min(1)),
      limit: z.number().min(1).optional(),
      startAt: z.number().min(0).optional(),
    }))
    .query(({ ctx, input }) => {
      return ctx.db.event.findMany({
        where: {
          location: {
            in: input.locations,
          }
        },
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
        take: input.limit ?? 10,
        skip: input.startAt ?? 0,
      });
    }),

  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      location: z.string().min(1),
      date: z.string().min(1),
      duration: z.number().min(1),
      image: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Get photographerId
      const photographerId = await ctx.db.photographer.findUnique(
        {
          where: { userId: ctx.session.user.id },
          select: { id: true }
        })
        .then((photographer) => {
          if (!photographer) {
            throw new Error("Photographer not found");
          }
          return photographer.id;
        });

      if (input.image) {
        const buffer = Buffer.from(input.image, "base64");

        const result = await ctx.cloudinaryClient.uploadStream(buffer, `/app/${photographerId}/events`)
          .catch((error) => {
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
      }).catch((error) => {
        logger.error("Error creating event", { error: error as Error });
        if (error instanceof Error) {
          throw error;
        }
        throw new Error("Error creating event");
      })
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      photographerId: z.string().min(1),
      name: z.string().min(1),
      description: z.string().min(1),
      location: z.string().min(1),
      date: z.string().min(1),
      time: z.string().min(1),
      duration: z.number().min(1),
      price: z.string().min(1),
      image: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.event.update({
        where: { id: input.id },
        data: input,
      });
    }),

  delete: protectedProcedure
    .input(z.object({
      id: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.event.delete({
        where: { id: input.id },
      });
    }),

  addLikeToEvent: protectedProcedure
    .input(z.object({
      targetId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      return ctx.db.event.update({
        where: { id: input.targetId },
        data: {
          eventLikes: {
            create: {
              userId,
            },
          },
        },
      });
    }),

  addCommentToEvent: protectedProcedure
    .input(z.object({
      eventId: z.string().min(1),
      content: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      return ctx.db.event.update({
        where: { id: input.eventId },
        data: {
          comments: {
            create: {
              userId,
              content: input.content,
            },
          },
        },
      });
    }),

  deleteCommentFromEvent: protectedProcedure
    .input(z.object({
      id: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.comment.delete({
        where: { id: input.id },
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
      }).catch((error) => {
        logger.error("Error checking for existing comment like", { error: error as Error });
        throw new Error("Error checking for existing comment like");
      });

      if (!commentLike) {
        return ctx.db.comment.update({
          where: { id: input.targetId },
          data: {
            commentLikes: {
              create: {
                userId,
              },
            }
          }
        }).catch((error) => {
          logger.error("Error creating comment like", { error: error as Error });
          throw new Error("Error creating comment like");
        });
      }

      return ctx.db.commentLike.update({
        where: { id: commentLike.id },
        data: {
          isDeleted: !commentLike.isDeleted,
        }
      }).catch((error) => {
        logger.error("Error adding comment like", { error: error as Error });
        throw new Error("Error adding comment like");
      });
    }),

  getCommentsByEventId: protectedProcedure
    .input(z.object({
      eventId: z.string().min(1),
    }))
    .query(async ({ ctx, input }) => {
      const comments = await ctx.db.comment.findMany({
        where: { eventId: input.eventId },
        include: {
          user: {
            select: {
              profilePic: true,
              firstName: true,
              lastName: true,
            },
          },
          commentLikes: {
            where: {
              isDeleted: false,
            },
            include: {
              user: {
                select: {
                  id: true,
                },
              },
            }
          },
        },
      }).catch((error) => {
        logger.error("Error getting comments", { error: error as Error });
        throw new Error("Error getting comments");
      });

      return comments.map((comment) => {
        return { ...comment, commentLikes: comment.commentLikes.length, isLiked: comment.commentLikes.some((like) => like.userId === ctx.session.user.id) };
      });
    }),

  getCommentById: protectedProcedure
    .input(z.object({
      id: z.string().min(1),
    }))
    .query(async ({ ctx, input }) => {
      return ctx.db.comment.findFirst({
        where: { id: input.id },
        include: {
          user: {
            select: {
              profilePic: true,
              firstName: true,
              lastName: true,
            },
          },
          commentLikes: {
            where: {
              isDeleted: false,
            },
            include: {
              user: {
                select: {
                  id: true,
                },
              },
            }
          },
        },
      }).then((comment) => {
        if (!comment) {
          throw new Error("Comment not found");
        }

        return { ...comment, commentLikes: comment.commentLikes.length, isLiked: comment.commentLikes.some((like) => like.userId === ctx.session.user.id) };
      }).catch((error) => {
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

  search: protectedProcedure
    .input(z.object({
      query: z.string().min(1),
      beforeDate: z.date(),
      afterDate: z.date(),
    }))
    .query(({ ctx, input }) => {
      return ctx.db.event.findMany({
        where: {
          OR: [
            { title: { contains: input.query, mode: "insensitive" } },
            { description: { contains: input.query, mode: "insensitive" } },
            { location: { contains: input.query, mode: "insensitive" } },
            { date: { gte: input.afterDate, lte: input.beforeDate } },
          ],
        },
      });
    }),
});