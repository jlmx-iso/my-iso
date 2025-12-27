
import { authRouter } from "./routers/auth";
import { eventRouter } from "./routers/event";
import { favoriteRouter } from "./routers/favorite";
import { googleRouter } from "./routers/google";
import { messageRouter } from "./routers/message";
import { photographerRouter } from "./routers/photographer";
import { subscriptionRouter } from "./routers/subscription";
import { userRouter } from "./routers/user";

import { createTRPCRouter } from "~/server/api/trpc";

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
  subscription: subscriptionRouter,
  user: userRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
