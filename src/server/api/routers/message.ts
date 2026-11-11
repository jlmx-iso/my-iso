import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "../trpc";

import { logger } from "~/_utils";
import { captureEvent } from "~/server/_lib/posthog";
import type { CloudflareEnv } from "../../../../cloudflare-env";


export const messageRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({
      content: z.string().min(1).max(5000),
      isEncrypted: z.boolean().optional().default(false),
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
            isEncrypted: input.isEncrypted,
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
        });

        // Broadcast to Durable Object ChatRoom for real-time delivery
        try {
          const cfCtx = (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")] as { env?: CloudflareEnv } | undefined;
          const chatRoomNs = cfCtx?.env?.CHAT_ROOM;
          if (chatRoomNs) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
            const stub = chatRoomNs.get(chatRoomNs.idFromName(input.threadId)) as any;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            void stub.broadcast(JSON.stringify({
              content: message.content,
              createdAt: message.createdAt.toISOString(),
              id: message.id,
              isEncrypted: message.isEncrypted,
              senderId: message.senderId,
            }));
          }
        } catch (broadcastErr) {
          // Non-fatal: WS broadcast failure does not fail the mutation
          logger.error("Failed to broadcast message to ChatRoom DO", { error: broadcastErr });
        }

        void captureEvent(ctx.session.user.id, 'message_sent', { platform: input.platform, thread_id: input.threadId });

        return message;
      } catch (error) {
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
      isEncrypted: z.boolean().optional().default(false),
      participants: z.array(z.string().min(1)),
      platform: z.enum(['ios', 'web']).optional().default('web'),
      threadKeys: z.array(z.object({
        encryptedKey: z.string(),
        userId: z.string(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const allParticipants = [...input.participants, ctx.session.user.id];
      try {
        const thread = await ctx.db.$transaction(async (tx) => {
          const newThread = await tx.messageThread.create({
            data: {
              participants: {
                connect: allParticipants.map((id) => ({ id })),
              },
            },
          });
          await tx.message.create({
            data: {
              content: input.initialMessage,
              isEncrypted: input.isEncrypted,
              sender: { connect: { id: ctx.session.user.id } },
              thread: { connect: { id: newThread.id } },
            },
          });
          if (input.threadKeys?.length) {
            await tx.threadKey.createMany({
              data: input.threadKeys.map(({ encryptedKey, userId }) => ({
                encryptedKey,
                threadId: newThread.id,
                userId,
              })),
            });
          }
          return newThread;
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
            isEncrypted: true,
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
        return await ctx.db.messageThread.findFirst({
          select: {
            _count: {
              select: {
                messages: true,
              },
            },
            id: true,
            messages: {
              orderBy: {
                createdAt: "asc",
              },
              select: {
                content: true,
                createdAt: true,
                id: true,
                isEncrypted: true,
                sender: {
                  select: {
                    firstName: true,
                    id: true,
                    lastName: true,
                    profilePic: true,
                  },
                },
              },
              skip: input.startAt,
              take: 20,
              where: {
                isDeleted: false,
              },
            },
            threadKeys: {
              select: {
                encryptedKey: true,
                userId: true,
              },
              where: {
                userId: ctx.session.user.id,
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
