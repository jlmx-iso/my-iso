import { TRPCError } from "@trpc/server";
import { z } from "zod";


import { logger } from "~/_utils";
import {
  classifyRecipients,
  findOrCreateThread,
  findThreadByParticipants,
  MAX_THREAD_PARTICIPANTS,
  relatedToUser,
} from "~/server/_db/messaging";
import type { ExtendedPrismaClient } from "~/server/_db/softDelete";
import { captureEvent } from "~/server/_lib/posthog";
import { publishThreadMessage } from "~/server/_lib/realtime";
import { RateLimits } from "~/server/_utils/rateLimit";

import { createTRPCRouter, protectedProcedure, rateLimit } from "../trpc";


const recipientSelect = {
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
} as const;

const senderSelect = {
  firstName: true,
  id: true,
  lastName: true,
  profilePic: true,
} as const;

/** Number of most recent messages a thread query returns. */
const THREAD_PAGE_SIZE = 50;

/** Longest message body, in characters. */
export const MAX_MESSAGE_LENGTH = 5000;

/** Threads returned by one page of the conversation list. */
const THREAD_LIST_PAGE_SIZE = 50;

const messageContent = z.string().trim().min(1).max(MAX_MESSAGE_LENGTH);
const idInput = z.string().min(1).max(64);

/** The other people in a thread: at least one, capped, no duplicates needed. */
const otherParticipants = z.array(idInput).min(1).max(MAX_THREAD_PARTICIPANTS - 1);

/**
 * Marks a thread as active now, which is what the conversation list sorts
 * by. Ordering only: a failure is logged and does not fail the send.
 */
async function touchThread(
  db: Pick<ExtendedPrismaClient, "messageThread">,
  threadId: string,
  at: Date,
): Promise<void> {
  try {
    await db.messageThread.update({ data: { updatedAt: at }, where: { id: threadId } });
  } catch (error) {
    logger.warn("Failed to update thread activity time", { error, threadId });
  }
}

export const messageRouter = createTRPCRouter({
  create: protectedProcedure
    .use(rateLimit(RateLimits.MESSAGE_SEND))
    .input(z.object({
      content: messageContent,
      platform: z.enum(['ios', 'web']).optional().default('web'),
      threadId: idInput,
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

        await touchThread(ctx.db, input.threadId, message.createdAt);

        publishThreadMessage(input.threadId, {
          content: message.content,
          createdAt: message.createdAt,
          id: message.id,
          sender: message.sender,
        });

        captureEvent(ctx.session.user.id, 'message_sent', { platform: input.platform, thread_id: input.threadId });

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
  /**
   * Starts a conversation, or continues the existing one: a participant set
   * has exactly one thread (MessageThread.participantKey is unique), so a
   * repeated call posts into that thread instead of creating a duplicate.
   *
   * A NEW thread may only be opened with people the caller already has a
   * relationship with (see relatedToUser): a Discover match, a booking or
   * application between them, or the other person having written first.
   * Without it, any member could message every other member unprompted.
   */
  createThread: protectedProcedure
    .use(rateLimit(RateLimits.THREAD_CREATE))
    .input(z.object({
      initialMessage: messageContent,
      participants: otherParticipants,
      platform: z.enum(['ios', 'web']).optional().default('web'),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const others = [...new Set(input.participants)].filter((id) => id !== userId);
      if (others.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot start a conversation with yourself.' });
      }
      const allParticipants = [userId, ...others];

      try {
        let thread = await findThreadByParticipants(ctx.db, allParticipants);
        let created = false;

        if (!thread) {
          const { missing, unrelated } = await classifyRecipients(ctx.db, userId, others);
          // One answer for "no such user" and "not someone you can message",
          // so this cannot be used to test which user ids exist.
          if (missing.length > 0 || unrelated.length > 0) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'You can only message people you have matched with or have a booking with.',
            });
          }
          const result = await findOrCreateThread(ctx.db, allParticipants);
          thread = { id: result.id };
          created = result.created;
        }

        // Separate statement, not a transaction (D1 has none). If it fails the
        // thread exists without this message, and a retry lands in the same
        // thread.
        const message = await ctx.db.message.create({
          data: {
            content: input.initialMessage,
            senderId: userId,
            threadId: thread.id,
          },
          include: { sender: { select: senderSelect } },
        });

        if (created) {
          captureEvent(userId, 'thread_created', { platform: input.platform, thread_id: thread.id });
        } else {
          await touchThread(ctx.db, thread.id, message.createdAt);
          publishThreadMessage(thread.id, {
            content: message.content,
            createdAt: message.createdAt,
            id: message.id,
            sender: message.sender,
          });
        }

        return ctx.db.messageThread.findUniqueOrThrow({ where: { id: thread.id } });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        logger.error("Unable to create message thread", { error, senderId: userId });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create message thread. Please try again.',
          cause: error,
        });
      }
    }),

  delete: protectedProcedure
    .input(z.object({
      id: idInput,
    }))
    .mutation(async ({ ctx, input }) => {
      // Scoped to the caller's own messages: someone else's message id
      // matches nothing and is reported as not found.
      const result = await ctx.db.message.updateMany({
        data: { isDeleted: true },
        where: { id: input.id, senderId: ctx.session.user.id },
      });
      if (result.count === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Message not found' });
      }
      return { id: input.id };
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

  /**
   * People the caller may start a conversation with, by name. Limited to
   * existing relationships (see relatedToUser), which is also what keeps
   * members who are not discoverable out of the results for everyone else.
   */
  getPotentialRecipients: protectedProcedure
    .use(rateLimit(RateLimits.SEARCH))
    .input(z.object({ query: z.string().trim().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      return ctx.db.user.findMany({
        orderBy: [{ firstName: 'asc' }, { id: 'asc' }],
        select: recipientSelect,
        take: 10,
        where: {
          AND: [
            { id: { not: userId } },
            relatedToUser(userId),
            {
              OR: [
                { firstName: { contains: input.query } },
                { lastName: { contains: input.query } },
                { photographer: { companyName: { contains: input.query } } },
              ],
            },
          ],
        },
      });
    }),

  /**
   * Resolves a "message this person" deep link. Returns null unless the
   * caller may message them (same rule as createThread), so a user id alone
   * reveals nothing about a member the caller has no relationship with.
   */
  getRecipientById: protectedProcedure
    .input(z.object({ userId: idInput }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      // You cannot start a conversation with yourself.
      if (input.userId === userId) return null;

      return ctx.db.user.findFirst({
        select: recipientSelect,
        where: { AND: [{ id: input.userId }, relatedToUser(userId)] },
      });
    }),

  getThreadById: protectedProcedure
    .input(z.object({
      startAt: z.number().int().min(0).max(100_000).default(0),
      threadId: idInput,
    }))
    .query(async ({ ctx, input }) => {
      try {
        const thread = await ctx.db.messageThread.findFirst({
          select: {
            _count: {
              select: {
                messages: { where: { isDeleted: false } },
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
      participants: otherParticipants,
    }))
    .query(async ({ ctx, input }) => {
      // The caller is always part of the set, so only their own threads match.
      const allParticipants = [...input.participants, ctx.session.user.id];
      try {
        const thread = await findThreadByParticipants(ctx.db, allParticipants);
        if (!thread) return null;
        return await ctx.db.messageThread.findUnique({ where: { id: thread.id } });
      } catch (error) {
        logger.error("Unable to get thread by participants", { error, userId: ctx.session.user.id });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve thread. Please try again.',
          cause: error,
        });
      }
    }),
  /**
   * The caller's conversations, most recently active first. Pass the id of
   * the last thread received as `cursor` for the next page.
   */
  getThreadsByUserId: protectedProcedure
    .input(z.object({
      cursor: idInput.optional(),
      limit: z.number().int().min(1).max(THREAD_LIST_PAGE_SIZE).default(THREAD_LIST_PAGE_SIZE),
    }).optional())
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.db.messageThread.findMany({
          ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: input?.limit ?? THREAD_LIST_PAGE_SIZE,
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
