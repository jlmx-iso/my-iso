import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { instagramHandleNullable, logger, socialHandleNullable } from "~/_utils";
import { isRecordNotFound, isUniqueViolation } from "~/server/_db/errors";
import {
  base64ImageInput,
  ownImageUrlInput,
  requireValidImage,
  websiteUrlInput,
} from "~/server/_utils/image";
import { RateLimits } from "~/server/_utils/rateLimit";
import { createTRPCRouter, protectedProcedure, publicProcedure, rateLimit } from "~/server/api/trpc";

/** Portfolio images one photographer may have (deleted ones do not count). */
export const MAX_PORTFOLIO_IMAGES = 60;

const idInput = z.string().min(1).max(64);
const tagsInput = z.array(z.string().trim().min(1).max(40)).max(20);

/**
 * What an anonymous visitor may see of a photographer. Deliberately a
 * `select`: a column added to Photographer later stays private until it is
 * listed here. `id` and `userId` are opaque ids the public profile page needs
 * (portfolio and review lookups, the "message" link); the account's email
 * address and phone number live on User and are never selected.
 */
const publicPhotographerSelect = {
  avatar: true,
  bio: true,
  companyName: true,
  facebook: true,
  id: true,
  instagram: true,
  location: true,
  name: true,
  tiktok: true,
  twitter: true,
  userId: true,
  vimeo: true,
  website: true,
  youtube: true,
} as const;

const publicPortfolioImageSelect = {
  createdAt: true,
  description: true,
  id: true,
  image: true,
  isFeatured: true,
  photographerId: true,
  sortOrder: true,
  tags: true,
  title: true,
  updatedAt: true,
} as const;

export const photographerRouter = createTRPCRouter({
  count: protectedProcedure.query(({ ctx }) => {
    return ctx.db.photographer.count();
  }),

  create: protectedProcedure
    .input(z.object({
      avatar: ownImageUrlInput.optional(),
      bio: z.string().min(1).max(1000).optional(),
      companyName: z.string().trim().min(1).max(200),
      facebook: socialHandleNullable,
      instagram: instagramHandleNullable,
      location: z.string().trim().min(1).max(200),
      name: z.string().trim().min(1).max(200),
      tiktok: socialHandleNullable,
      twitter: socialHandleNullable,
      vimeo: socialHandleNullable,
      website: websiteUrlInput.nullable(),
      youtube: socialHandleNullable,
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.photographer.create({
          data: { ...input, userId: ctx.session.user.id },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({ code: "CONFLICT", message: "You already have a photographer profile." });
        }
        throw error;
      }
    }),

  getById: protectedProcedure
    .input(z.object({ id: idInput }))
    .query(({ ctx, input }) => {
      return ctx.db.photographer.findFirst({
        where: { id: input.id },
      });
    }),

  getByUserId: protectedProcedure
    .input(z.object({ userId: idInput }))
    .query(({ ctx, input }) => {
      return ctx.db.photographer.findFirst({
        where: { userId: input.userId },
      });
    }),

  /** Public profile lookup by handle (the shareable /photographer/<handle> page). */
  getByUsername: publicProcedure
    .input(z.object({ username: z.string().trim().min(1).max(64) }))
    .query(({ ctx, input }) => {
      // Tolerate "@name" and capitals in the URL; stored handles are
      // lowercase without "@" (older ones are matched as typed).
      const bare = input.username.replace(/^@/, "");
      const handles = [...new Set([input.username, bare, bare.toLowerCase()])];
      return ctx.db.photographer.findFirst({
        select: publicPhotographerSelect,
        where: { user: { handle: { in: handles } } },
      });
    }),

  update: protectedProcedure
    .input(z.object({
      avatar: ownImageUrlInput.optional(),
      bio: z.string().min(1).max(1000).nullable(),
      companyName: z.string().trim().min(1).max(200),
      facebook: socialHandleNullable,
      firstName: z.string().trim().min(1).max(100),
      id: idInput,
      instagram: instagramHandleNullable,
      lastName: z.string().trim().min(1).max(100),
      location: z.string().trim().min(1).max(200),
      tiktok: socialHandleNullable,
      twitter: socialHandleNullable,
      vimeo: socialHandleNullable,
      website: websiteUrlInput.nullable(),
      youtube: socialHandleNullable,
    }))
    .mutation(async ({ ctx, input }) => {
      const { firstName, id, lastName, ...photographerData } = input;
      const name = `${firstName} ${lastName}`;

      // The profile first: if the id is not the caller's own profile nothing
      // at all is changed.
      let photographer;
      try {
        photographer = await ctx.db.photographer.update({
          data: { ...photographerData, name },
          where: { id, userId: ctx.session.user.id },
        });
      } catch (error) {
        if (isRecordNotFound(error)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found" });
        }
        logger.error("Failed to update profile", { error });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to update profile" });
      }

      // Sync name to User record
      await ctx.db.user.update({
        data: { firstName, lastName },
        where: { id: ctx.session.user.id },
      });

      return photographer;
    }),

  uploadProfileImage: protectedProcedure
    .use(rateLimit(RateLimits.UPLOAD))
    .input(z.object({
      image: base64ImageInput,
    }))
    .mutation(async ({ ctx, input }) => {
      const image = requireValidImage(input.image);

      const result = await ctx.cloudinaryClient.upload(image, `${ctx.session.user.id}/profile`);
      const imageUrl = result.isOk ? result.value?.secure_url : undefined;
      if (!imageUrl) {
        logger.error("Failed to upload profile image", { error: result.isErr ? result.error : "no URL returned" });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to upload profile image" });
      }

      // updateMany: a user without a photographer profile yet (mid-onboarding)
      // still gets their account picture.
      await ctx.db.photographer.updateMany({
        data: { avatar: imageUrl },
        where: { userId: ctx.session.user.id },
      });

      return ctx.db.user.update({
        data: { profilePic: imageUrl },
        select: { id: true, profilePic: true },
        where: { id: ctx.session.user.id },
      });
    }),

  addPortfolioImage: protectedProcedure
    .use(rateLimit(RateLimits.UPLOAD))
    .input(z.object({
      image: base64ImageInput,
      title: z.string().trim().min(1).max(200),
      description: z.string().max(1000).optional(),
      tags: tagsInput.default([]),
      isFeatured: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const image = requireValidImage(input.image);

      const photographer = await ctx.db.photographer.findFirst({
        select: { id: true },
        where: { userId: ctx.session.user.id },
      });

      if (!photographer) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Photographer profile not found" });
      }

      // Checked before the upload so that a full portfolio costs nothing.
      const existingCount = await ctx.db.portfolioImage.count({
        where: { photographerId: photographer.id },
      });
      if (existingCount >= MAX_PORTFOLIO_IMAGES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `A portfolio can hold at most ${MAX_PORTFOLIO_IMAGES} images. Remove one to add another.`,
        });
      }

      const uploadResult = await ctx.cloudinaryClient.upload(
        image,
        `${ctx.session.user.id}/portfolio`
      );
      const imageUrl = uploadResult.isOk ? uploadResult.value?.secure_url : undefined;
      if (!imageUrl) {
        logger.error("Failed to upload portfolio image", { error: uploadResult.isErr ? uploadResult.error : "no URL returned" });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to upload portfolio image" });
      }

      const maxOrder = await ctx.db.portfolioImage.aggregate({
        _max: { sortOrder: true },
        where: { photographerId: photographer.id },
      });
      const nextSortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

      return ctx.db.portfolioImage.create({
        data: {
          photographerId: photographer.id,
          image: imageUrl,
          title: input.title,
          description: input.description ?? null,
          tags: JSON.stringify(input.tags),
          isFeatured: input.isFeatured,
          sortOrder: nextSortOrder,
        },
      });
    }),

  getPortfolioImages: publicProcedure
    .input(z.object({ photographerId: idInput }))
    .query(({ ctx, input }) => {
      return ctx.db.portfolioImage.findMany({
        select: publicPortfolioImageSelect,
        where: {
          photographerId: input.photographerId,
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        // A portfolio never holds more (see addPortfolioImage).
        take: MAX_PORTFOLIO_IMAGES,
      });
    }),

  updatePortfolioImage: protectedProcedure
    .input(z.object({
      id: idInput,
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(1000).nullable().optional(),
      tags: tagsInput.optional(),
      isFeatured: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.portfolioImage.update({
          // Ownership is part of the lookup: another user's image is "not found".
          where: { id: input.id, isDeleted: false, photographer: { userId: ctx.session.user.id } },
          data: {
            ...(input.title !== undefined && { title: input.title }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.tags !== undefined && { tags: JSON.stringify(input.tags) }),
            ...(input.isFeatured !== undefined && { isFeatured: input.isFeatured }),
          },
        });
      } catch (error) {
        if (isRecordNotFound(error)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Portfolio image not found" });
        }
        throw error;
      }
    }),

  deletePortfolioImage: protectedProcedure
    .input(z.object({ id: idInput }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.portfolioImage.update({
          where: { id: input.id, photographer: { userId: ctx.session.user.id } },
          data: { isDeleted: true },
        });
      } catch (error) {
        if (isRecordNotFound(error)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Portfolio image not found" });
        }
        throw error;
      }
    }),

  reorderPortfolioImages: protectedProcedure
    .input(z.object({
      images: z
        .array(z.object({ id: idInput, sortOrder: z.number().int().min(0).max(10_000) }))
        .min(1)
        .max(MAX_PORTFOLIO_IMAGES),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify all images belong to the current user before updating
      const ids = [...new Set(input.images.map((i) => i.id))];
      const owned = await ctx.db.portfolioImage.count({
        where: { id: { in: ids }, photographer: { userId: ctx.session.user.id } },
      });

      if (owned !== ids.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'One or more portfolio images were not found' });
      }

      // Batch form: sent to the database as one unit. Display order is not a
      // security property, so a partially applied reorder would be harmless.
      await ctx.db.$transaction(
        input.images.map(({ id, sortOrder }) =>
          ctx.db.portfolioImage.update({ where: { id }, data: { sortOrder } }),
        ),
      );
    }),
})
