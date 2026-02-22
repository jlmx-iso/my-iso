
import { authRouter } from "./routers/auth";
import { bookingRouter } from "./routers/booking";
import { discoverRouter } from "./routers/discover";
import { eventRouter } from "./routers/event";
import { favoriteRouter } from "./routers/favorite";
import { googleRouter } from "./routers/google";
import { messageRouter } from "./routers/message";
import { notificationRouter } from "./routers/notification";
import { photographerRouter } from "./routers/photographer";
import { referralRouter } from "./routers/referral";
import { reviewRouter } from "./routers/review";
import { searchRouter } from "./routers/search";
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
  booking: bookingRouter,
  discover: discoverRouter,
  event: eventRouter,
  favorite: favoriteRouter,
  google: googleRouter,
  message: messageRouter,
  notification: notificationRouter,
  photographer: photographerRouter,
  referral: referralRouter,
  review: reviewRouter,
  search: searchRouter,
  subscription: subscriptionRouter,
  user: userRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
