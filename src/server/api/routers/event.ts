import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { logger } from "~/_utils";
import { isUniqueViolation } from "~/server/_db/errors";
import { base64ImageInput, requireValidImage, type ValidImage } from "~/server/_utils/image";
import { enforceRateLimit, RateLimits } from "~/server/_utils/rateLimit";
import { createTRPCRouter, protectedProcedure, rateLimit } from "~/server/api/trpc";

export const MAX_COMMENT_LENGTH = 2000;
export const MAX_EVENT_DURATION_HOURS = 72;

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const idInput = z.string().min(1).max(64);

/** `limit` + `cursor` (id of the last item of the previous page). */
const pageInput = {
  cursor: idInput.optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An event date: a full ISO-8601 timestamp, not in the past (one day of
 * slack for time zones) and not absurdly far ahead.
 */
const eventDateInput = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .refine(
    (date) => {
      const now = Date.now();
      return date.getTime() >= now - DAY_MS && date.getTime() <= now + 5 * 365 * DAY_MS;
    },
    { message: "Event date must be in the future, within the next five years." },
  );

const eventDurationInput = z.number().int().min(1).max(MAX_EVENT_DURATION_HOURS);
const eventTitleInput = z.string().trim().min(1).max(200);
const eventDescriptionInput = z.string().trim().min(1).max(5000);
const eventLocationInput = z.string().trim().min(1).max(200);

const eventPhotographerSelect = {
  avatar: true,
  name: true,
  userId: true,
} as const;

const commentAuthorSelect = {
  firstName: true,
  lastName: true,
  profilePic: true,
} as const;

/** Loads a comment's live like count and whether `userId` likes it. */
function commentInclude(userId: string) {
  return {
    _count: { select: { commentLikes: { where: { isDeleted: false } } } },
    commentLikes: {
      select: { id: true },
      take: 1,
      where: { isDeleted: false, userId },
    },
    user: { select: commentAuthorSelect },
  } as const;
}

function toCommentView<
  T extends { _count: { commentLikes: number }; commentLikes: Array<{ id: string }> },
>(comment: T) {
  const { _count, commentLikes, ...rest } = comment;
  return { ...rest, commentLikes: _count.commentLikes, isLiked: commentLikes.length > 0 };
}

export const eventRouter = createTRPCRouter({
  addCommentToEvent: protectedProcedure
    .use(rateLimit(RateLimits.COMMENT_CREATE))
    .input(z.object({
      content: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
      eventId: idInput,
    }))
    .mutation(async ({ ctx, input }) => {
      // findUnique hides deleted events, so they cannot be commented on.
      const event = await ctx.db.event.findUnique({
        select: { id: true },
        where: { id: input.eventId },
      });
      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      }

      return ctx.db.comment.create({
        data: {
          content: input.content,
          eventId: event.id,
          userId: ctx.session.user.id,
        },
      });
    }),

  /**
   * Likes an event. Idempotent: EventLike is unique per (event, user), so a
   * repeated or concurrent call leaves exactly one like.
   */
  addLikeToEvent: protectedProcedure
    .input(z.object({
      targetId: idInput,
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const event = await ctx.db.event.findUnique({
        select: { id: true },
        where: { id: input.targetId },
      });
      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      }

      try {
        await ctx.db.eventLike.create({ data: { eventId: event.id, userId } });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Liked before (possibly since removed): make sure it is active.
        await ctx.db.eventLike.updateMany({
          data: { isDeleted: false },
          where: { eventId: event.id, userId },
        });
      }
      return { liked: true };
    }),

  removeLikeFromEvent: protectedProcedure
    .input(z.object({
      targetId: idInput,
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.eventLike.updateMany({
        data: { isDeleted: true },
        where: { eventId: input.targetId, userId: ctx.session.user.id },
      });
      return { liked: false };
    }),

  /**
   * Toggles the caller's like on a comment. CommentLike is unique per
   * (comment, user); each branch is one conditional statement, so a double
   * click cannot create a second like.
   */
  addOrRemoveEventCommentLike: protectedProcedure
    .input(z.object({
      targetId: idInput,
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const own = { commentId: input.targetId, userId };

      const removed = await ctx.db.commentLike.updateMany({
        data: { isDeleted: true },
        where: { ...own, isDeleted: false },
      });
      if (removed.count > 0) return { liked: false };

      const restored = await ctx.db.commentLike.updateMany({
        data: { isDeleted: false },
        where: { ...own, isDeleted: true },
      });
      if (restored.count > 0) return { liked: true };

      const comment = await ctx.db.comment.findUnique({
        select: { id: true },
        where: { id: input.targetId },
      });
      if (!comment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found" });
      }

      try {
        await ctx.db.commentLike.create({ data: own });
      } catch (error) {
        // A concurrent request created the like first.
        if (!isUniqueViolation(error)) throw error;
      }
      return { liked: true };
    }),

  create: protectedProcedure
    .use(rateLimit(RateLimits.EVENT_CREATE))
    .input(z.object({
      date: eventDateInput,
      description: eventDescriptionInput,
      duration: eventDurationInput,
      image: base64ImageInput.optional(),
      location: eventLocationInput,
      title: eventTitleInput,
    }))
    .mutation(async ({ ctx, input }) => {
      const { image: rawImage, ...fields } = input;
      const image = rawImage ? requireValidImage(rawImage) : undefined;

      const photographer = await ctx.db.photographer.findUnique({
        select: { id: true },
        where: { userId: ctx.session.user.id },
      });
      if (!photographer) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Photographer not found" });
      }

      const imageUrl = image
        ? await uploadEventImage(ctx, photographer.id, image)
        : undefined;

      return ctx.db.event.create({
        data: { ...fields, image: imageUrl, photographerId: photographer.id },
      });
    }),

  delete: protectedProcedure
    .input(z.object({
      id: idInput,
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.event.updateMany({
        data: { isDeleted: true },
        where: {
          id: input.id,
          photographer: { userId: ctx.session.user.id },
        },
      });
      if (result.count === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      }
      return { id: input.id };
    }),

  deleteCommentFromEvent: protectedProcedure
    .input(z.object({
      id: idInput,
    }))
    .mutation(async ({ ctx, input }) => {
      // Scoped to the caller's own comments.
      const result = await ctx.db.comment.deleteMany({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (result.count === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found" });
      }
      return { id: input.id };
    }),

  getById: protectedProcedure
    .input(z.object({ id: idInput }))
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.event.findFirst({
        include: {
          photographer: { select: eventPhotographerSelect },
        },
        where: { id: input.id },
      });

      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      }

      const commentCount = await ctx.db.comment.count({
        where: { eventId: event.id },
      });

      return { ...event, commentCount };
    }),

  getByPhotographerId: protectedProcedure
    .input(z.object({ photographerId: idInput, ...pageInput }))
    .query(({ ctx, input }) => {
      return ctx.db.event.findMany({
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: input.limit,
        where: { photographerId: input.photographerId },
      });
    }),

  getCommentById: protectedProcedure
    .input(z.object({
      id: idInput,
    }))
    .query(async ({ ctx, input }) => {
      const comment = await ctx.db.comment.findFirst({
        include: commentInclude(ctx.session.user.id),
        where: { id: input.id },
      });
      if (!comment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found" });
      }
      return toCommentView(comment);
    }),

  getCommentCountByEventId: protectedProcedure
    .input(z.object({
      eventId: idInput,
    }))
    .query(async ({ ctx, input }) => {
      return ctx.db.comment.count({
        where: { eventId: input.eventId },
      });
    }),

  getCommentsByEventId: protectedProcedure
    .input(z.object({
      eventId: idInput,
      cursor: idInput.optional(),
      limit: z.number().int().min(1).max(100).default(100),
    }))
    .query(async ({ ctx, input }) => {
      const comments = await ctx.db.comment.findMany({
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: commentInclude(ctx.session.user.id),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: input.limit,
        where: { eventId: input.eventId },
      });

      return comments.map(toCommentView);
    }),

  getRecentByLocation: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
      locations: z.array(z.string().min(1).max(200)).max(10),
      startAt: z.number().int().min(0).max(10_000).optional(),
    }))
    .query(({ ctx, input }) => {
      // Extract city names from location strings for fuzzy matching
      // e.g. "Austin, TX, USA" → "Austin" so it matches "Austin, TX"
      const locationFilters = input.locations
        .map((loc) => loc.split(",")[0]?.trim())
        .filter((city): city is string => Boolean(city))
        .map((city) => ({ location: { contains: city } }));

      return ctx.db.event.findMany({
        include: {
          photographer: { select: eventPhotographerSelect },
        },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        skip: input.startAt ?? 0,
        take: input.limit ?? 10,
        where: {
          ...(locationFilters.length > 0
            ? { OR: locationFilters }
            : {}),
        },
      });
    }),

  search: protectedProcedure
    .use(rateLimit(RateLimits.SEARCH))
    .input(z.object({
      afterDate: z.date(),
      beforeDate: z.date(),
      query: z.string().trim().min(1).max(100),
    }))
    .query(({ ctx, input }) => {
      return ctx.db.event.findMany({
        orderBy: [{ date: "asc" }, { id: "asc" }],
        where: {
          date: { gte: input.afterDate, lte: input.beforeDate },
          OR: [
            { title: { contains: input.query } },
            { description: { contains: input.query } },
            { location: { contains: input.query } },
          ],
        },
        take: 50,
      });
    }),

  update: protectedProcedure
    .input(z.object({
      date: eventDateInput.optional(),
      description: eventDescriptionInput.optional(),
      duration: eventDurationInput.optional(),
      id: idInput,
      // A new image to upload (base64), never a URL to store as given.
      image: base64ImageInput.optional(),
      location: eventLocationInput.optional(),
      title: eventTitleInput.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, image: rawImage, ...fields } = input;
      const image = rawImage ? requireValidImage(rawImage) : undefined;

      // findFirst hides deleted events; ownership is part of the lookup.
      const event = await ctx.db.event.findFirst({
        select: { id: true, photographerId: true },
        where: { id, photographer: { userId: ctx.session.user.id } },
      });
      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      }

      const imageUrl = image
        ? await uploadEventImage(ctx, event.photographerId, image)
        : undefined;

      return ctx.db.event.update({
        data: { ...fields, ...(imageUrl ? { image: imageUrl } : {}) },
        where: { id: event.id },
      });
    }),
});

type UploadContext = {
  cloudinaryClient: {
    upload: (
      image: ValidImage,
      folder: string,
    ) => Promise<
      | { isErr: false; isOk: true; value: { secure_url: string } | undefined }
      | { error: unknown; isErr: true; isOk: false }
    >;
  };
  db: Parameters<typeof enforceRateLimit>[0];
  session: { user: { id: string } };
};

/** Uploads a validated event image and returns its Cloudinary URL. */
async function uploadEventImage(
  ctx: UploadContext,
  photographerId: string,
  image: ValidImage,
): Promise<string> {
  await enforceRateLimit(ctx.db, RateLimits.UPLOAD, `user:${ctx.session.user.id}`);

  const result = await ctx.cloudinaryClient.upload(image, `/app/${photographerId}/events`);
  const url = result.isOk ? result.value?.secure_url : undefined;
  if (!url) {
    logger.error("Error uploading event image", { error: result.isErr ? result.error : "no URL returned" });
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error uploading image" });
  }
  return url;
}
