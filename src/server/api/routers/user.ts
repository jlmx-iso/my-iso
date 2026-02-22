import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const userRouter = createTRPCRouter({
  /**
   * Get the current authenticated user's profile data
   * SECURITY: Uses ctx.session.user.id — no user ID in input
   */
  getMe: protectedProcedure
    .query(async ({ ctx }) => {
      return ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.session.user.id },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          handle: true,
          city: true,
          state: true,
          country: true,
        },
      });
    }),

  /**
   * Update the current user's profile fields (phone, handle, city, state, country)
   * SECURITY: Uses ctx.session.user.id — no user ID in input
   */
  updateProfile: protectedProcedure
    .input(z.object({
      phone: z.string().min(1).optional(),
      handle: z.string().min(1).optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      country: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.user.update({
          where: { id: ctx.session.user.id },
          data: input,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            handle: true,
            city: true,
            state: true,
            country: true,
          },
        });
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'That handle is already taken. Please choose a different one.',
          });
        }
        throw error;
      }
    }),

  /**
   * Add a photographer to the authenticated user's favorites
   * SECURITY: Uses ctx.session.user.id to prevent authorization bypass
   */
  addFavorite: protectedProcedure
    .input(z.object({ photographerId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.favorite.create({
        data: {
          targetId: input.photographerId,
          user: {
            connect: { id: ctx.session.user.id },
          },
        },
      });
    }),

  /**
   * Get the authenticated user's favorite photographers
   * SECURITY: Uses ctx.session.user.id to prevent viewing other users' favorites
   */
  getFavorites: protectedProcedure
    .query(async ({ ctx }) => {
      return ctx.db.favorite.findMany({
        where: {
          userId: ctx.session.user.id,
        },
      });
    }),

  /**
   * Remove a photographer from the authenticated user's favorites
   * SECURITY: Uses ctx.session.user.id to prevent modifying other users' favorites
   */
  removeFavorite: protectedProcedure
    .input(z.object({ photographerId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.favorite.deleteMany({
        where: {
          targetId: input.photographerId,
          userId: ctx.session.user.id,
        },
      });
    }),
});