import { Client } from '@googlemaps/google-maps-services-js';

import { env } from '~/env';

export const googleMapsClient = new Client({
    config: {
        params: {
            key: env.GOOGLE_PLACES_API_KEY,
        },
    },
});


