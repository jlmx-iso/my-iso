import { createTRPCRouter } from "~/server/api/trpc";
import { photographerRouter } from "./routers/photographer";
import { eventRouter } from "./routers/event";
import { favoriteRouter } from "./routers/favorite";
import { messageRouter } from "./routers/message";
import { authRouter } from "./routers/auth";
import { userRouter } from "./routers/user";
import { googleRouter } from "./routers/google";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  auth: authRouter,
  event: eventRouter,
  favorite: favoriteRouter,
  google: googleRouter,
  message: messageRouter,
  photographer: photographerRouter,
  user: userRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
