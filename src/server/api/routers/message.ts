import { TRPCError } from "@trpc/server";
import { z } from "zod";


import { logger } from "~/_utils";
import { captureEvent } from "~/server/_lib/posthog";
import { publishThreadMessage } from "~/server/_lib/realtime";

import { createTRPCRouter, protectedProcedure } from "../trpc";


const senderSelect = {
  firstName: true,
  id: true,
  lastName: true,
  profilePic: true,
} as const;

/** Number of most recent messages a thread query returns. */
const THREAD_PAGE_SIZE = 50;

export const messageRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({
      content: z.string().min(1).max(5000),
      platform: z.enum(['ios', 'web']).optional().default('web'),
      threadId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        // Verify user is a participant of the thread
        const thread = await ctx.db.messageThread.findFirst({
          where: {
            id: input.threadId,
            participants: { some: { id: ctx.session.user.id } },
          },
        });
        if (!thread) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a participant of this thread' });
        }

        const message = await ctx.db.message.create({
          data: {
            content: input.content,
            sender: {
              connect: {
                id: ctx.session.user.id,
              },
            },
            thread: {
              connect: {
                id: input.threadId,
              },
            }
          },
          include: { sender: { select: senderSelect } },
        });

        publishThreadMessage(input.threadId, {
          content: message.content,
          createdAt: message.createdAt,
          id: message.id,
          sender: message.sender,
        });

        void captureEvent(ctx.session.user.id, 'message_sent', { platform: input.platform, thread_id: input.threadId });

        return message;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        logger.error("Unable to create message", { error, threadId: input.threadId, userId: ctx.session.user.id });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create message. Please try again.',
          cause: error,
        });
      }
    }),
  createThread: protectedProcedure
    .input(z.object({
      initialMessage: z.string().min(1).max(5000),
      participants: z.array(z.string().min(1)),
      platform: z.enum(['ios', 'web']).optional().default('web'),
    }))
    .mutation(async ({ ctx, input }) => {
      const allParticipants = [...new Set([...input.participants, ctx.session.user.id])];
      try {
        // One nested write rather than an interactive transaction, which
        // Cloudflare D1 does not support.
        const thread = await ctx.db.messageThread.create({
          data: {
            messages: {
              create: {
                content: input.initialMessage,
                sender: { connect: { id: ctx.session.user.id } },
              },
            },
            participants: {
              connect: allParticipants.map((id) => ({ id })),
            },
          },
        });

        void captureEvent(ctx.session.user.id, 'thread_created', { platform: input.platform, thread_id: thread.id });

        return thread;
      } catch (error) {
        logger.error("Unable to create message thread", { error, senderId: ctx.session.user.id });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create message thread. Please try again.',
          cause: error,
        });
      }
    }),

  delete: protectedProcedure
    .input(z.object({
      id: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return ctx.db.message.update({
          data: { isDeleted: true },
          where: { id: input.id, senderId: ctx.session.user.id },
        });
      } catch (error) {
        logger.error("Unable to delete message", { error, messageId: input.id, userId: ctx.session.user.id });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete message. Please try again.',
          cause: error,
        });
      }
    }),

  getLatestThreadByUserId: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        return await ctx.db.messageThread.findFirst({
          orderBy: {
            updatedAt: "desc",
          },
          select: {
            id: true,
          },
          where: {
            participants: {
              some: {
                id: {
                  equals: ctx.session.user.id,
                },
              }
            }
          },
        });
      } catch (error) {
        logger.error("Unable to get latest thread by userId", { error, userId: ctx.session.user.id });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve latest thread. Please try again.',
          cause: error,
        });
      }
    }),

  getLatestThreadMessage: protectedProcedure
    .input(z.object({
      threadId: z.string().min(1),
    }))
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.db.message.findFirst({
          orderBy: {
            createdAt: "desc",
          },
          select: {
            content: true,
            createdAt: true,
            id: true,
            sender: {
              select: {
                firstName: true,
                id: true,
                lastName: true,
                profilePic: true,
              },
            },
            updatedAt: true,
          },
          where: {
            thread: {
              AND: [
                {
                  id: {
                    equals: input.threadId,
                  },
                },
                {
                  participants: {
                    some: {
                      id: {
                        equals: ctx.session.user.id,
                      },
                    },
                  },
                },
              ],
            },
          },
        });
      } catch (error) {
        logger.error("Unable to get latest thread message", { error, threadId: input.threadId, userId: ctx.session.user.id });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve latest message. Please try again.',
          cause: error,
        });
      }
    }),

  getPotentialRecipients: protectedProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return ctx.db.user.findMany({
          select: {
            firstName: true,
            id: true,
            lastName: true,
            photographer: {
              select: {
                companyName: true,
                id: true,
              }
            },
            profilePic: true
          },
          take: 10,
          where: {
            id: { not: ctx.session.user.id },
            OR: [
              {
                firstName: {
                  contains: input.query,
                }
              },
              {
                lastName: {
                  contains: input.query,
                }
              },
              {
                photographer: {
                  companyName: {
                    contains: input.query,
                  }
                }
              }
            ]
          }
        })
      } catch (error) {
        logger.error("Unable to find potential recipients", { error, userId: ctx.session.user.id });
        return [];
      };
    }),

  getRecipientById: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      // You cannot start a conversation with yourself.
      if (input.userId === ctx.session.user.id) return null;

      return ctx.db.user.findUnique({
        select: {
          firstName: true,
          id: true,
          lastName: true,
          photographer: {
            select: {
              companyName: true,
              id: true,
            }
          },
          profilePic: true
        },
        where: { id: input.userId },
      });
    }),

  getThreadById: protectedProcedure
    .input(z.object({
      startAt: z.number().min(0).default(0),
      threadId: z.string().min(1),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const thread = await ctx.db.messageThread.findFirst({
          select: {
            _count: {
              select: {
                messages: true,
              },
            },
            id: true,
            messages: {
              // Newest page first; put back in reading order below.
              orderBy: {
                createdAt: "desc",
              },
              select: {
                content: true,
                createdAt: true,
                id: true,
                sender: { select: senderSelect },
              },
              skip: input.startAt,
              take: THREAD_PAGE_SIZE,
              where: {
                isDeleted: false,
              },
            },
            participants: {
              select: {
                firstName: true,
                id: true,
                lastName: true,
                photographer: {
                  select: {
                    companyName: true,
                    id: true,
                  }
                },
                profilePic: true,
              },
            },
          },
          where: {
            id: input.threadId,
            participants: { some: { id: ctx.session.user.id } },
          },
        });
        if (!thread) return null;

        return { ...thread, messages: thread.messages.reverse() };
      } catch (error) {
        logger.error("Failed to retrieve message thread", { error, threadId: input.threadId, userId: ctx.session.user.id });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve message thread. Please try again.',
          cause: error,
        });
      }
    }),
  getThreadByParticipants: protectedProcedure
    .input(z.object({
      participants: z.array(z.string().min(1)),
    }))
    .query(async ({ ctx, input }) => {
      const allParticipants = [...input.participants, ctx.session.user.id];
      try {
        return await ctx.db.messageThread.findFirst({
          where: {
            AND: allParticipants.map((id) => ({
              participants: { some: { id } },
            })),
          },
        });
      } catch (error) {
        logger.error("Unable to get thread by participants", { error, participants: input.participants, userId: ctx.session.user.id });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve thread. Please try again.',
          cause: error,
        });
      }
    }),
  getThreadsByUserId: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        return await ctx.db.messageThread.findMany({
          select: {
            id: true,
            participants: {
              select: {
                firstName: true,
                id: true,
                lastName: true,
                photographer: {
                  select: {
                    companyName: true,
                    id: true,
                  }
                },
                profilePic: true,
              },
            },
          },
          where: {
            participants: {
              some: {
                id: {
                  equals: ctx.session.user.id,
                },
              }
            }
          },
        });
      } catch (error) {
        logger.error("Unable to get threads by userId", { error, userId: ctx.session.user.id });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve message threads. Please try again.',
          cause: error,
        });
      }
    }),
});
