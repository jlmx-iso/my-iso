import { z } from "zod";

import { INSIGHT_RANGES, type InsightRange } from "~/_utils/viewSources";
import { getInsights } from "~/server/_db/insights";
import { RateLimits } from "~/server/_utils/rateLimit";
import { createTRPCRouter, proProcedure, rateLimit } from "~/server/api/trpc";

export const insightsRouter = createTRPCRouter({
  /**
   * Profile analytics for a Pro member, over the 7, 30 or 90 complete UTC
   * days ending yesterday (with the period before, for comparison):
   * profile views per day and by source, views of and applications to their
   * own events, and conversations others started with them. Counts only:
   * nothing says who. Pro only (FORBIDDEN otherwise); the page shows members
   * without Pro what they would get instead of numbers.
   */
  getSummary: proProcedure
    .use(rateLimit(RateLimits.INSIGHTS))
    .input(z.object({
      days: z.number().int().refine((days): days is InsightRange => INSIGHT_RANGES.some((range) => range === days), {
        message: `One of ${INSIGHT_RANGES.join(", ")} days.`,
      }),
    }))
    .query(({ ctx, input }) => getInsights(ctx.db, ctx.session.user.id, input.days)),
});
