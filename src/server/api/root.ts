
import { createTRPCRouter } from "~/server/api/trpc";

import { accountRouter } from "./routers/account";
import { authRouter } from "./routers/auth";
import { bookingRouter } from "./routers/booking";
import { discoverRouter } from "./routers/discover";
import { eventRouter } from "./routers/event";
import { googleRouter } from "./routers/google";
import { insightsRouter } from "./routers/insights";
import { inviteRouter } from "./routers/invite";
import { messageRouter } from "./routers/message";
import { notificationRouter } from "./routers/notification";
import { photographerRouter } from "./routers/photographer";
import { reviewRouter } from "./routers/review";
import { searchRouter } from "./routers/search";
import { subscriptionRouter } from "./routers/subscription";
import { supportRouter } from "./routers/support";
import { userRouter } from "./routers/user";
import { waitlistRouter } from "./routers/waitlist";


/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  account: accountRouter,
  auth: authRouter,
  booking: bookingRouter,
  discover: discoverRouter,
  event: eventRouter,
  google: googleRouter,
  insights: insightsRouter,
  invite: inviteRouter,
  message: messageRouter,
  notification: notificationRouter,
  photographer: photographerRouter,
  review: reviewRouter,
  search: searchRouter,
  subscription: subscriptionRouter,
  support: supportRouter,
  user: userRouter,
  waitlist: waitlistRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
