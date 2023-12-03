import { z } from "zod";
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
    .query(({ ctx, input }) => {
      return ctx.db.event.findFirst({
        where: { id: input.id },
      });
    }),
  
  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1),
      photographerId: z.string().min(1),
      name: z.string().min(1),
      description: z.string().min(1),
      location: z.string().min(1),
      date: z.string().min(1),
      time: z.string().min(1),
      duration: z.string().min(1),
      price: z.string().min(1),
      image: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {

      return ctx.db.event.create({
        data: input,
      });
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
      duration: z.string().min(1),
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
  
  addCommentToEvent: protectedProcedure
    .input(z.object({
      eventId: z.string().min(1),
      userId: z.string().min(1),
      content: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.event.update({
        where: { id: input.eventId },
        data: {
          comments: {
            create: {
              userId: input.userId,
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