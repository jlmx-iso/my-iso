import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";


export const messageRouter = createTRPCRouter({
  getByUserId: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.db.messageThread.findMany({
        where: {
          participants: {
            some: {
              id: input.userId
            },
          },
        },
        select: {
          id: true,
          participants: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              profilePic: true,
            },
          },
        },
      });
    }),
  
  getThreadById: protectedProcedure
    .input(z.object({
      threadId: z.string().min(1),
      startAt: z.number().min(0).default(0),
    }))
    .query(({ ctx, input }) => {
      return ctx.db.messageThread.findUnique({
        where: {
          id: input.threadId,
        },
        select: {
          _count: {
            select: {
              messages: true,
            },
          },
          id: true,
          participants: true,
          messages: {
            where: {
              isDeleted: false,
            },
            orderBy: {
              createdAt: "asc",
            },
            skip: input.startAt,
            take: 20,
            select: {
              id: true,
              content: true,
              createdAt: true,
              sender: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  profilePic: true,
                },
              },
            },
          },
        },
      });
    }),
  
  create: protectedProcedure
    .input(z.object({
      userId: z.string().min(1),
      content: z.string().min(1),
      threadId: z.string().min(1),
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
        where: { id: input.id },
        data: { isDeleted: true },
      });
    }),
});