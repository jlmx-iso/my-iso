import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { phoneSchemaOptional } from "~/_utils";
import { isUniqueViolation } from "~/server/_db/errors";
import { handleInput } from "~/server/_utils/handle";
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
          role: true,
        },
      });
    }),

  /**
   * Update the current user's profile fields (phone, handle, city, state, country)
   * SECURITY: Uses ctx.session.user.id — no user ID in input
   */
  updateProfile: protectedProcedure
    .input(z.object({
      firstName: z.string().trim().min(1).max(100).optional(),
      lastName: z.string().trim().min(1).max(100).optional(),
      phone: phoneSchemaOptional,
      handle: handleInput.optional(),
      city: z.string().trim().max(100).optional(),
      state: z.string().trim().max(100).optional(),
      country: z.string().trim().max(100).optional(),
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
        if (isUniqueViolation(error)) {
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
    .input(z.object({ photographerId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const photographer = await ctx.db.photographer.findUnique({
        select: { id: true },
        where: { id: input.photographerId },
      });
      if (!photographer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Photographer not found' });
      }

      // Idempotent: Favorite is unique per (user, target).
      return ctx.db.favorite.upsert({
        create: { targetId: photographer.id, userId },
        update: {},
        where: { userId_targetId: { targetId: photographer.id, userId } },
      });
    }),

  /**
   * Get the authenticated user's favorite photographers
   * SECURITY: Uses ctx.session.user.id to prevent viewing other users' favorites
   */
  getFavorites: protectedProcedure
    .input(z.object({
      cursor: z.string().min(1).max(64).optional(),
      limit: z.number().int().min(1).max(200).default(200),
    }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.db.favorite.findMany({
        ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input?.limit ?? 200,
        where: {
          userId: ctx.session.user.id,
        },
      });
    }),

  /**
   * Whether the caller has favourited `targetId` (a photographer id). One
   * indexed lookup, so the answer does not depend on how many favourites the
   * caller has, unlike searching the capped getFavorites list.
   */
  isFavorite: protectedProcedure
    .input(z.object({ targetId: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const favorite = await ctx.db.favorite.findUnique({
        select: { id: true },
        where: { userId_targetId: { targetId: input.targetId, userId: ctx.session.user.id } },
      });
      return { isFavorite: favorite !== null };
    }),

  /**
   * Remove a photographer from the authenticated user's favorites
   * SECURITY: Uses ctx.session.user.id to prevent modifying other users' favorites
   */
  removeFavorite: protectedProcedure
    .input(z.object({ photographerId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.favorite.deleteMany({
        where: {
          targetId: input.photographerId,
          userId: ctx.session.user.id,
        },
      });
    }),
});