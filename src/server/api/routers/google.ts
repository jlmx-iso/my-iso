import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { placeAutocomplete } from "~/server/_lib/google";

import { createTRPCRouter, publicProcedure } from "../trpc";



export const googleRouter = createTRPCRouter({
    getAutocompleteLocations: publicProcedure
        .input(z.object({ query: z.string().min(1) }))
        .query(async ({ input }) => {
            const result = await placeAutocomplete(input.query);

            if (result.isErr) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Failed to fetch location suggestions'
                });
            }

            return result.value;
        }),
});