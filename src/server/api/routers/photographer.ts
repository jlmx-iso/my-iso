import { z } from "zod";

import { logger } from "~/_utils";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";

export const photographerRouter = createTRPCRouter({
  count: publicProcedure.query(({ ctx }) => {
    return ctx.db.photographer.count();
  }),

  create: protectedProcedure
    .input(z.object({
      avatar: z.string().min(1).optional(),
      bio: z.string().min(1).optional(),
      companyName: z.string().min(1),
      facebook: z.string().min(1).nullable(),
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
      return ctx.db.photographer.create({
        data: { ...input, userId: ctx.session.user.id },
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
            { name: { contains: input.query } },
            { companyName: { contains: input.query } },
            { location: { contains: input.query } },
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
        where: { id: input.id, userId: ctx.session.user.id },
      }).catch((error: unknown) => {
        logger.error("Failed to update profile", { error: error as Error });
        throw new Error("Failed to update profile");
      });
    }),

  uploadProfileImage: protectedProcedure
    .input(z.object({
      image: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.cloudinaryClient.upload(input.image, `${ctx.session.user.id}/profile`).catch(
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
      }).catch((error: unknown) => {
        logger.error("Failed to update photographer profile", { error: error as Error });
        throw new Error("Failed to update profile");
      });

      return ctx.db.user.update({
        data: {
          profilePic: result.value?.secure_url,
        },
        where: { id: ctx.session.user.id },
      }).catch((error: unknown) => {
        logger.error("Failed to update user profile pic", { error: error as Error });
        throw new Error("Failed to update user profile pic");
      });
    }),

  addPortfolioImage: protectedProcedure
    .input(z.object({
      image: z.string().min(1),
      title: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
      tags: z.array(z.string()).default([]),
      isFeatured: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const photographer = await ctx.db.photographer.findFirst({
        where: { userId: ctx.session.user.id },
      });

      if (!photographer) {
        throw new Error("Photographer profile not found");
      }

      const uploadResult = await ctx.cloudinaryClient.upload(
        input.image,
        `${ctx.session.user.id}/portfolio`
      ).catch((error) => {
        logger.error("Failed to upload portfolio image", { error: error as Error });
        throw new Error("Failed to upload portfolio image");
      });

      if (uploadResult.isErr) {
        logger.error("Failed to upload portfolio image", { error: uploadResult.error });
        throw new Error("Failed to upload portfolio image");
      }

      const imageUrl = uploadResult.value?.secure_url;
      if (!imageUrl) {
        throw new Error("Failed to get image URL from upload");
      }

      return ctx.db.portfolioImage.create({
        data: {
          photographerId: photographer.id,
          image: imageUrl,
          title: input.title,
          description: input.description ?? null,
          tags: JSON.stringify(input.tags),
          isFeatured: input.isFeatured,
        },
      });
    }),

  getPortfolioImages: publicProcedure
    .input(z.object({ photographerId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.db.portfolioImage.findMany({
        where: {
          photographerId: input.photographerId,
          isDeleted: false,
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  updatePortfolioImage: protectedProcedure
    .input(z.object({
      id: z.string().min(1),
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).nullable().optional(),
      tags: z.array(z.string()).optional(),
      isFeatured: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const image = await ctx.db.portfolioImage.findFirst({
        where: { id: input.id },
        include: { photographer: true },
      });

      if (!image) {
        throw new Error("Portfolio image not found");
      }

      if (image.photographer.userId !== ctx.session.user.id) {
        throw new Error("Not authorized to update this image");
      }

      return ctx.db.portfolioImage.update({
        where: { id: input.id },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.tags !== undefined && { tags: JSON.stringify(input.tags) }),
          ...(input.isFeatured !== undefined && { isFeatured: input.isFeatured }),
        },
      });
    }),

  deletePortfolioImage: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const image = await ctx.db.portfolioImage.findFirst({
        where: { id: input.id },
        include: { photographer: true },
      });

      if (!image) {
        throw new Error("Portfolio image not found");
      }

      if (image.photographer.userId !== ctx.session.user.id) {
        throw new Error("Not authorized to delete this image");
      }

      return ctx.db.portfolioImage.update({
        where: { id: input.id },
        data: { isDeleted: true },
      });
    }),
})