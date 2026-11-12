import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { ErrorReason, logger } from "~/_utils";
import {
  classifyRecipients,
  findOrCreateThread,
  findThreadByParticipants,
  MAX_THREAD_PARTICIPANTS,
  messageableBy,
  relatedToUser,
} from "~/server/_db/messaging";
import { toPage } from "~/server/_db/pagination";
import type { ExtendedPrismaClient } from "~/server/_db/softDelete";
import { captureEvent } from "~/server/_lib/posthog";
import { publishThreadMessage } from "~/server/_lib/realtime";
import { checkRateLimit, RateLimits } from "~/server/_utils/rateLimit";

import { reasonedError } from "../reasonedError";
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

const idInput = z.string().min(1).max(64);

/** Number of most recent messages a thread query returns. */
const THREAD_PAGE_SIZE = 50;

/** Longest message body, in characters. */
export const MAX_MESSAGE_LENGTH = 5000;

/** Threads returned by one page of the conversation list. */
const THREAD_LIST_PAGE_SIZE = 50;

/** Most people one recipient search returns. */
export const MAX_RECIPIENT_RESULTS = 20;

/**
 * The one answer for "you may not message this person" and "no such person",
 * so a user id cannot be probed for existence or for discoverability.
 */
const recipientNotMessageable = () =>
  reasonedError(
    "FORBIDDEN",
    ErrorReason.RECIPIENT_NOT_MESSAGEABLE,
    "This person isn't accepting new messages. Match with them on Discover or apply to one of their events to connect.",
  );

const threadListSelect = {
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
        },
      },
      profilePic: true,
    },
  },
} as const;

const threadListInput = z
  .object({
    cursor: idInput.optional(),
    limit: z.number().int().min(1).max(THREAD_LIST_PAGE_SIZE).default(THREAD_LIST_PAGE_SIZE),
  })
  .optional();

/**
 * One page of `userId`'s conversations, most recently active first, plus one
 * extra row when there are more (see toPage). `cursor` is the id of the last
 * thread of the previous page.
 */
function findThreadsOf(
  db: Pick<ExtendedPrismaClient, "messageThread">,
  userId: string,
  input: z.infer<typeof threadListInput>,
  extra: 0 | 1,
) {
  return db.messageThread.findMany({
    ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: threadListSelect,
    take: (input?.limit ?? THREAD_LIST_PAGE_SIZE) + extra,
    where: { participants: { some: { id: userId } } },
  });
}

const messageContent = z.string().trim().min(1).max(MAX_MESSAGE_LENGTH);

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
   * A NEW thread may only be opened with people the caller may message (see
   * messageableBy): anyone discoverable, or someone they matched with, have
   * an active booking with, or who wrote to them first. Otherwise the answer
   * is FORBIDDEN with reason `recipient_not_messageable`.
   *
   * New threads are also capped per caller per day
   * (MAX_NEW_CONVERSATIONS_PER_DAY): past it the answer is TOO_MANY_REQUESTS
   * with reason `new_conversation_limit`. Existing threads are unaffected.
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
          const { notMessageable } = await classifyRecipients(ctx.db, userId, others);
          if (notMessageable.length > 0) throw recipientNotMessageable();

          // Counted only here: for a conversation that does not exist yet,
          // with people the caller is allowed to write to.
          const allowance = await checkRateLimit(
            ctx.db,
            RateLimits.NEW_CONVERSATION_DAILY,
            `user:${userId}`,
          );
          if (!allowance.allowed) {
            throw reasonedError(
              "TOO_MANY_REQUESTS",
              ErrorReason.NEW_CONVERSATION_LIMIT,
              `You've started ${RateLimits.NEW_CONVERSATION_DAILY.limit} new conversations today, which is the daily limit. You can still reply in your existing conversations, and start new ones tomorrow.`,
            );
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
   * People the caller may start a conversation with, by name: the people
   * they already have a relationship with first, then other discoverable
   * members, MAX_RECIPIENT_RESULTS at most. Members who are not discoverable
   * never appear for someone they have no relationship with.
   */
  getPotentialRecipients: protectedProcedure
    .use(rateLimit(RateLimits.SEARCH))
    .input(z.object({ query: z.string().trim().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const matchesQuery = {
        OR: [
          { firstName: { contains: input.query } },
          { lastName: { contains: input.query } },
          { photographer: { companyName: { contains: input.query } } },
        ],
      };
      const orderBy = [{ firstName: "asc" as const }, { id: "asc" as const }];

      const related = await ctx.db.user.findMany({
        orderBy,
        select: recipientSelect,
        take: MAX_RECIPIENT_RESULTS,
        where: { AND: [{ id: { not: userId } }, relatedToUser(userId), matchesQuery] },
      });
      if (related.length >= MAX_RECIPIENT_RESULTS) return related;

      const discoverable = await ctx.db.user.findMany({
        orderBy,
        select: recipientSelect,
        take: MAX_RECIPIENT_RESULTS - related.length,
        where: {
          AND: [
            { id: { notIn: [userId, ...related.map((user) => user.id)] } },
            { isDiscoverable: true },
            matchesQuery,
          ],
        },
      });
      return [...related, ...discoverable];
    }),

  /**
   * Resolves a "message this person" deep link. Answers FORBIDDEN with reason
   * `recipient_not_messageable` unless the caller may message them (same
   * rule as createThread), and exactly the same when there is no such user.
   * Null for the caller's own id.
   */
  getRecipientById: protectedProcedure
    .input(z.object({ userId: idInput }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      // You cannot start a conversation with yourself.
      if (input.userId === userId) return null;

      const recipient = await ctx.db.user.findFirst({
        select: recipientSelect,
        where: { AND: [{ id: input.userId }, messageableBy(userId)] },
      });
      if (!recipient) throw recipientNotMessageable();
      return recipient;
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
   * The caller's conversations, most recently active first, as a plain
   * array. Pass the id of the last thread received as `cursor` for the next
   * page; getThreadsPage does the same and says whether there is one.
   */
  getThreadsByUserId: protectedProcedure
    .input(threadListInput)
    .query(async ({ ctx, input }) => {
      try {
        return await findThreadsOf(ctx.db, ctx.session.user.id, input, 0);
      } catch (error) {
        logger.error("Unable to get threads by userId", { error, userId: ctx.session.user.id });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve message threads. Please try again.',
          cause: error,
        });
      }
    }),

  /**
   * getThreadsByUserId as `{ items, nextCursor }`: pass `nextCursor` back as
   * `cursor` for the next (less recently active) page; null on the last one.
   */
  getThreadsPage: protectedProcedure
    .input(threadListInput)
    .query(async ({ ctx, input }) => {
      const rows = await findThreadsOf(ctx.db, ctx.session.user.id, input, 1);
      return toPage(rows, input?.limit ?? THREAD_LIST_PAGE_SIZE);
    }),
});
