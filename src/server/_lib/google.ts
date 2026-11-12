import { logger } from '~/_utils';
import { Result } from '~/_utils/result';
import { env } from '~/env';

type GooglePlacesResponse = {
  predictions: Array<{ description: string }>;
  status: string;
  error_message?: string;
};

/**
 * Edge-compatible Google Places API autocomplete using fetch
 * Migrated from @googlemaps/google-maps-services-js for Cloudflare Workers compatibility
 */
export async function placeAutocomplete(
  input: string,
  sessionToken?: string,
): Promise<Result<string[], Error>> {
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
    url.searchParams.set('input', input);
    url.searchParams.set('types', '(cities)');
    url.searchParams.set('key', env.GOOGLE_PLACES_API_KEY);
    if (sessionToken) {
      url.searchParams.set('sessiontoken', sessionToken);
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
      logger.error('Google Places API HTTP error', { status: response.status });
      return Result.err(new Error(`Google Places API HTTP ${response.status}`));
    }

    const data = await response.json() as GooglePlacesResponse;

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      logger.error('Google Places API status error', {
        status: data.status,
        message: data.error_message
      });
      return Result.err(new Error(`Google Places API: ${data.status}`));
    }

    const descriptions = data.predictions.map((prediction) => prediction.description);
    return Result.ok(descriptions);
  } catch (error) {
    logger.error('Google Places API exception', { error });
    return Result.err(error as Error);
  }
}
