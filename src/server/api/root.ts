import { createTRPCRouter } from "~/server/api/trpc";
import { photographerRouter } from "./routers/photographer";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  photographer: photographerRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
