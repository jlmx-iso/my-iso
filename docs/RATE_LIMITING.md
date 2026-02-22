# Rate Limiting Setup Guide

This guide explains how to set up and use rate limiting in your Cloudflare Workers/Pages application.

## Overview

Rate limiting prevents API abuse by restricting the number of requests a user can make within a time window. This implementation uses Cloudflare KV for distributed rate limiting across edge locations.

## Setup

### 1. Create KV Namespace

```bash
# Create production KV namespace
wrangler kv:namespace create RATE_LIMITER

# Create preview KV namespace for local development
wrangler kv:namespace create RATE_LIMITER --preview
```

This will output namespace IDs that look like:
```
{ binding = "RATE_LIMITER", id = "abc123..." }
{ binding = "RATE_LIMITER", preview_id = "xyz789..." }
```

### 2. Update wrangler.toml

Replace the placeholder IDs in `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "RATE_LIMITER"
id = "abc123..."  # Replace with your production ID
preview_id = "xyz789..."  # Replace with your preview ID
```

### 3. Deploy or Test Locally

```bash
# Local development (uses preview_id)
npm run dev

# Deploy to Cloudflare
wrangler pages deploy
```

## Usage

### Basic Example

```typescript
import { checkRateLimit, RateLimits } from "~/server/_utils/rateLimit";
import { TRPCError } from "@trpc/server";

export const exampleRouter = createTRPCRouter({
  sensitiveOperation: protectedProcedure
    .mutation(async ({ ctx }) => {
      // Check rate limit using user ID
      const rateLimit = await checkRateLimit(
        ctx.session.user.id,
        RateLimits.STRICT
      );

      if (!rateLimit.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`
        });
      }

      // Proceed with operation
      // ...
    }),
});
```

### Rate Limit by IP Address

For public endpoints, rate limit by IP address:

```typescript
import { headers } from "next/headers";

export const publicRouter = createTRPCRouter({
  publicEndpoint: publicProcedure
    .mutation(async ({ ctx }) => {
      // Get IP address from headers
      const headersList = await headers();
      const ip = headersList.get('cf-connecting-ip')
        ?? headersList.get('x-forwarded-for')
        ?? 'unknown';

      const rateLimit = await checkRateLimit(ip, RateLimits.GENEROUS);

      if (!rateLimit.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many requests. Please try again later.'
        });
      }

      // Proceed with operation
      // ...
    }),
});
```

### Custom Rate Limits

Define custom rate limits for specific use cases:

```typescript
import { checkRateLimit } from "~/server/_utils/rateLimit";

// Custom: 50 requests per 5 minutes
const customLimit = { limit: 50, window: 300 };

const rateLimit = await checkRateLimit(identifier, customLimit);
```

## Predefined Rate Limits

The utility provides these predefined configurations:

| Name | Limit | Window | Use Case |
|------|-------|--------|----------|
| `STRICT` | 5 requests | 5 minutes | Password reset, email verification |
| `STANDARD` | 100 requests | 1 minute | Authenticated API requests |
| `GENEROUS` | 1000 requests | 1 minute | Public endpoints, read operations |
| `AUTH` | 10 requests | 15 minutes | Login/signup attempts |

## Integration Recommendations

### 1. Authentication Endpoints

Apply `RateLimits.AUTH` to:
- `/api/auth/signin`
- `/api/auth/signup`
- Email verification requests
- Password reset requests

### 2. Write Operations

Apply `RateLimits.STANDARD` to:
- Creating/updating/deleting resources
- File uploads
- Payment operations

### 3. Read Operations

Apply `RateLimits.GENEROUS` to:
- Search queries
- List endpoints
- Public data access

### 4. Sensitive Operations

Apply `RateLimits.STRICT` to:
- Email sending
- SMS sending
- Expensive computations
- External API calls

## Example: Auth Router Rate Limiting

```typescript
// src/server/api/routers/auth.ts
import { checkRateLimit, RateLimits } from "~/server/_utils/rateLimit";
import { TRPCError } from "@trpc/server";
import { headers } from "next/headers";

export const authRouter = createTRPCRouter({
  sendVerificationEmail: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      // Rate limit by email to prevent abuse
      const rateLimit = await checkRateLimit(
        `email:${input.email}`,
        RateLimits.STRICT
      );

      if (!rateLimit.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Too many verification emails sent. Please try again in ${rateLimit.retryAfter} seconds.`
        });
      }

      // Also rate limit by IP
      const headersList = await headers();
      const ip = headersList.get('cf-connecting-ip') ?? 'unknown';
      const ipRateLimit = await checkRateLimit(
        `ip:${ip}`,
        RateLimits.AUTH
      );

      if (!ipRateLimit.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many requests from your IP. Please try again later.'
        });
      }

      // Send verification email
      // ...
    }),
});
```

## Monitoring

The rate limiting utility logs warnings when limits are exceeded:

```json
{
  "level": "warn",
  "message": "Rate limit exceeded",
  "metadata": {
    "identifier": "user_123",
    "count": 101,
    "limit": 100,
    "retryAfter": 45
  }
}
```

Monitor these logs to:
- Detect abuse patterns
- Adjust rate limits
- Identify legitimate users hitting limits

## Local Development

If KV namespace is not configured locally, the rate limiter will:
1. Log a warning
2. Allow all requests (fail-open)

This ensures development can continue without KV setup, but you should configure it for production-like testing.

## Troubleshooting

### Rate limiting not working

1. Verify KV namespace is created: `wrangler kv:namespace list`
2. Check wrangler.toml has correct IDs
3. Ensure binding name is "RATE_LIMITER"
4. Check logs for KV-related errors

### All requests allowed in production

- KV binding might not be configured
- Check Cloudflare dashboard → Workers & Pages → KV
- Verify deployment includes KV bindings

### Rate limits too strict/loose

Adjust the predefined limits in `src/server/_utils/rateLimit.ts` or use custom configurations for specific endpoints.
