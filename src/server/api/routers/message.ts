import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "../trpc";


export const messageRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({
      content: z.string().min(1),
      threadId: z.string().min(1),
      userId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const message = await ctx.db.message.create({
        data: {
          content: input.content,
          sender: {
            connect: {
              id: input.userId,
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
    }),
  
  delete: protectedProcedure
    .input(z.object({
      id: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.message.update({
        data: { isDeleted: true },
        where: { id: input.id },
      });
    }),
  
  getByUserId: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.db.messageThread.findMany({
        select: {
          id: true,
          participants: {
            select: {
              email: true,
              firstName: true,
              id: true,
              lastName: true,
              profilePic: true,
            },
          },
        },
        where: {
          participants: {
            some: {
              id: input.userId
            },
          },
        },
      });
    }),
  
  getThreadById: protectedProcedure
    .input(z.object({
      startAt: z.number().min(0).default(0),
      threadId: z.string().min(1),
    }))
    .query(({ ctx, input }) => {
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
              createdAt: "asc",
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
          participants: true,
        },
        where: {
          id: input.threadId,
        },
      });
    }),
});