import { type MessageThread } from "@prisma/client";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "../trpc";

import { logger } from "~/_utils";


export const messageRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({
      content: z.string().min(1),
      threadId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
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
        });
        return message;
      } catch (error) {
        logger.error("Unable to create message", { error, threadId: input.threadId, userId: ctx.session.user.id })
      }
    }),
  createThread: protectedProcedure
    .input(z.object({
      initialMessage: z.string().min(1),
      participants: z.array(z.string().min(1)),
    }))
    .mutation(async ({ ctx, input }) => {
      input.participants.push(ctx.session.user.id);
      let thread: MessageThread
      try {
        thread = await ctx.db.messageThread.create({
          data: {
            participants: {
              connect: input.participants.map((id) => ({ id })),
            },
          },
        });
      } catch (error) {
        logger.error("unable to create message thread", { error, senderId: ctx.session.user.id });
        return null;
      }
      try {
        await ctx.db.message.create({
          data: {
            content: input.initialMessage,
            sender: {
              connect: {
                id: ctx.session.user.id,
              },
            },
            thread: {
              connect: {
                id: thread.id,
              },
            },
          },
        });
        return thread;
      } catch (error) {
        logger.error("unable to create message", { error, senderId: ctx.session.user.id, threadId: thread.id });
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
        logger.error("unable to delete message", { error, messageId: input.id, userId: ctx.session.user.id })
      }
    }),

  getLatestThreadByUserId: protectedProcedure
    .query(({ ctx }) => {
      try {
        return ctx.db.messageThread.findFirst({
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
        })
      } catch (error) {
        logger.error("unable to get latest thread by userId", { error, userId: ctx.session.user.id })
      }
    }
    ),

  getLatestThreadMessage: protectedProcedure
    .input(z.object({
      threadId: z.string().min(1),
    }))
    .query(({ ctx, input }) => {
      try {
        return ctx.db.message.findFirst({
          orderBy: {
            createdAt: "desc",
          },
          select: {
            content: true,
            createdAt: true,
            id: true,
            sender: {
              select: {
                email: true,
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
        logger.error("unable to get latest thread message", { error, threadId: input.threadId, userId: ctx.session.user.id });
      }
    }),

  getPotentialRecipients: protectedProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return ctx.db.user.findMany({
          select: {
            email: true,
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
            OR: [
              {
                firstName: {
                  contains: input.query,
                  mode: "insensitive",
                }
              },
              {
                lastName: {
                  contains: input.query,
                  mode: "insensitive",
                }
              },
              {
                email: {
                  contains: input.query,
                  mode: "insensitive",
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

  getThreadById: protectedProcedure
    .input(z.object({
      startAt: z.number().min(0).default(0),
      threadId: z.string().min(1),
    }))
    .query(({ ctx, input }) => {
      try {
        return ctx.db.messageThread.findUnique({
          select: {
            _count: {
              select: {
                messages: true,
              },
            },
            id: true,
            messages: {
              orderBy: {
                createdAt: "desc",
              },
              select: {
                content: true,
                createdAt: true,
                id: true,
                sender: {
                  select: {
                    email: true,
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
          },
        });
      } catch (error) {
        logger.error("issue retrieving message thread", { error, threadId: input.threadId, userId: ctx.session.user.id });
        return null;
      }
    }),
  getThreadByParticipants: protectedProcedure
    .input(z.object({
      participants: z.array(z.string().min(1)),
    }))
    .query(({ ctx, input }) => {
      input.participants.push(ctx.session.user.id);
      try {
        return ctx.db.messageThread.findFirst({
          where: {
            participants: {
              some: {
                id: {
                  in: input.participants,
                },
              },
            },
          },
        });
      } catch (error) {
        logger.error("Unable to get thread by participants", { error, participants: input.participants, userId: ctx.session.user.id });
      }
    }),
  getThreadsByUserId: protectedProcedure
    .query(({ ctx }) => {
      try {
        return ctx.db.messageThread.findMany({
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
        })
      } catch (error) {
        logger.error("unable to get threads by userId", { error, userId: ctx.session.user.id })
      }
    }),
});