/**
 * CORS (Cross-Origin Resource Sharing) utilities for edge runtime
 *
 * WHEN TO USE:
 * - Public API endpoints that need to be called from other domains
 * - Webhook endpoints (though most webhook providers don't require CORS)
 * - If you have a separate frontend domain calling your API
 *
 * WHEN NOT TO USE:
 * - tRPC endpoints (handled by tRPC itself)
 * - Same-origin requests (Next.js app calling its own API)
 * - Server-to-server webhooks (like Stripe webhooks)
 *
 * Edge-compatible implementation using standard Headers API
 */

export interface CorsOptions {
  origin?: string | string[];
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

const DEFAULT_OPTIONS: CorsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: [],
  credentials: false,
  maxAge: 86400, // 24 hours
};

/**
 * Add CORS headers to a Response
 * @param response - The Response object to add headers to
 * @param options - CORS configuration options
 * @returns Response with CORS headers
 */
export function addCorsHeaders(
  response: Response,
  options: CorsOptions = {}
): Response {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const headers = new Headers(response.headers);

  // Handle origin
  if (typeof opts.origin === 'string') {
    headers.set('Access-Control-Allow-Origin', opts.origin);
  } else if (Array.isArray(opts.origin)) {
    // For arrays, you'd need to check the request origin against allowed origins
    // This is a simplified version - uses first origin in array if available
    const firstOrigin = opts.origin[0];
    if (firstOrigin) {
      headers.set('Access-Control-Allow-Origin', firstOrigin);
    }
  }

  // Handle methods
  if (opts.methods) {
    headers.set('Access-Control-Allow-Methods', opts.methods.join(', '));
  }

  // Handle allowed headers
  if (opts.allowedHeaders) {
    headers.set('Access-Control-Allow-Headers', opts.allowedHeaders.join(', '));
  }

  // Handle exposed headers
  if (opts.exposedHeaders && opts.exposedHeaders.length > 0) {
    headers.set('Access-Control-Expose-Headers', opts.exposedHeaders.join(', '));
  }

  // Handle credentials
  if (opts.credentials) {
    headers.set('Access-Control-Allow-Credentials', 'true');
  }

  // Handle max age
  if (opts.maxAge) {
    headers.set('Access-Control-Max-Age', opts.maxAge.toString());
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Create a CORS preflight response for OPTIONS requests
 * @param options - CORS configuration options
 * @returns Response for OPTIONS request
 */
export function createCorsPreflightResponse(
  options: CorsOptions = {}
): Response {
  return addCorsHeaders(
    new Response(null, { status: 204 }),
    options
  );
}

/**
 * Example usage in an API route:
 *
 * ```typescript
 * import { addCorsHeaders, createCorsPreflightResponse } from '~/utils/cors';
 *
 * export async function OPTIONS() {
 *   return createCorsPreflightResponse({
 *     origin: 'https://example.com',
 *     methods: ['GET', 'POST'],
 *   });
 * }
 *
 * export async function POST(request: Request) {
 *   // Your API logic here
 *   const response = new Response(JSON.stringify({ success: true }), {
 *     headers: { 'Content-Type': 'application/json' },
 *   });
 *
 *   return addCorsHeaders(response, {
 *     origin: 'https://example.com',
 *   });
 * }
 * ```
 */
