import { z } from "zod";

import { logger } from "~/_utils";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";

export const photographerRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({
      avatar: z.string().min(1).optional(),
      bio: z.string().min(1),
      companyName: z.string().min(1),
      facebook: z.string().min(1).nullable(),
      instagram: z.string().min(1).nullable(),
      location: z.string().min(1),
      name: z.string().min(1),
      tiktok: z.string().min(1).nullable(),
      twitter: z.string().min(1).nullable(),
      userId: z.string().min(1),
      vimeo: z.string().min(1).nullable(),
      website: z.string().min(1).nullable(),
      youtube: z.string().min(1).nullable(),
    }))
    .mutation(async ({ ctx, input }) => {

      return ctx.db.photographer.create({
        data: input,
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.db.photographer.findFirst({
        where: { id: input.id },
      });
    }),

  getByUserId: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.db.photographer.findFirst({
        where: { userId: input.userId },
      });
    }),

  getByUsername: publicProcedure
    .input(z.object({ username: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.db.photographer.findFirst({
        where: {
          user: {
            handle: input.username,
          }
        },
      });
    }),

  search: publicProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.db.photographer.findMany({
        where: {
          OR: [
            { name: { contains: input.query, mode: "insensitive" } },
            { companyName: { contains: input.query, mode: "insensitive" } },
            { location: { contains: input.query, mode: "insensitive" } },
          ],
        },
      });
    }),

  update: protectedProcedure
    .input(z.object({
      avatar: z.string().min(1).optional(),
      bio: z.string().min(1).max(1000).nullable(),
      companyName: z.string().min(1),
      facebook: z.string().min(1).nullable(),
      id: z.string().min(1),
      instagram: z.string().min(1).nullable(),
      location: z.string().min(1),
      name: z.string().min(1),
      tiktok: z.string().min(1).nullable(),
      twitter: z.string().min(1).nullable(),
      vimeo: z.string().min(1).nullable(),
      website: z.string().min(1).nullable(),
      youtube: z.string().min(1).nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.photographer.update({
        data: input,
        where: { id: input.id, userId: ctx.session?.user.id },
      }).catch((error) => {
        logger.error("Failed to update profile", { error: error as Error });
        throw new Error("Failed to update profile");
      });
    }),

  uploadProfileImage: protectedProcedure
    .input(z.object({
      image: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.image, "base64");

      const result = await ctx.cloudinaryClient.uploadStream(buffer, `${ctx.session.user.id}/profile`).catch(
        (error) => {
          logger.error("Failed to upload profile image", { error: error as Error });
          throw new Error("Failed to upload profile image");
        }
      );

      if (result.isErr) {
        logger.error("Failed to upload profile image", { error: result.error });
        throw new Error("Failed to upload profile image");
      }

      logger.info("Uploaded profile image", { url: result.value?.secure_url });

      await ctx.db.photographer.update({
        data: {
          avatar: result.value?.secure_url,
        },
        where: { userId: ctx.session.user.id },
      }).catch((error) => {
        logger.error("Failed to update photographer profile", { error: error as Error });
        throw new Error("Failed to update profile");
      });

      return ctx.db.user.update({
        data: {
          profilePic: result.value?.secure_url,
        },
        where: { id: ctx.session.user.id },
      }).catch((error) => {
        logger.error("Failed to update user profile pic", { error: error as Error });
        throw new Error("Failed to update user profile pic");
      });
    }),
})