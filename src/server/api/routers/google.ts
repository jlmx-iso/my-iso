import { PlaceAutocompleteType } from "@googlemaps/google-maps-services-js";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "../trpc";

import { env } from "~/env";


export const googleRouter = createTRPCRouter({
    getAutocompleteLocations: publicProcedure
        .input(z.object({ input: z.string().min(1) }))
        .query(async ({ ctx, input }) => {
            const data = await ctx.googleMapsClient.placeAutocomplete({
                params: {
                    input: input.input,
                    key: env.GOOGLE_PLACES_API_KEY,
                    types: PlaceAutocompleteType.cities,
                },
            });
            return data.data.predictions.map((prediction) => prediction.description);
        }),
});