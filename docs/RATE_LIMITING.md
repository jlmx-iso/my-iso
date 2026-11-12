# Rate limiting

Rate limits are enforced in the application database (Cloudflare D1 in
production, SQLite locally and in tests). There is no KV namespace or other
binding to set up.

## How it works

`src/server/_utils/rateLimit.ts` keeps fixed-window counters in the `RateLimit`
table, one row per `(key, windowStart)`. Each check is a single statement:

```sql
INSERT INTO "RateLimit" ("key", "windowStart", "count", "expiresAt")
VALUES (?, ?, 1, ?)
ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "count" + 1
RETURNING "count"
```

Because the increment and the read are one statement, concurrent requests can
never observe the same count: exactly `limit` requests per window are allowed.

- `key` is `<policy name>:<keyed hash of the identifier>`. Identifiers (user
  ids, IP addresses, email addresses) are never stored or logged in the clear.
- Expired rows are swept opportunistically when a new window opens
  (`purgeExpiredRateLimits`), so no cron job is needed.
- Clients are identified by `CF-Connecting-IP` (`src/server/_utils/clientIp.ts`).
  `X-Forwarded-For` is never trusted on Cloudflare. IPv6 addresses are counted
  per /64.

## Failure mode

Each policy states what happens if the limiter itself fails (`onError`):

- `"deny"` (sign-in codes, invite codes, waitlist, mobile token exchange): the
  request is refused with `SERVICE_UNAVAILABLE`. Limits on these endpoints are
  a security control and must not silently disappear.
- `"allow"` (messaging, search, uploads and other signed-in activity): the
  request goes through and the failure is logged.

## Using it

All policies live in `RateLimits` in `src/server/_utils/rateLimit.ts`.

Per user (or per IP for anonymous callers), in one line on the procedure:

```ts
create: protectedProcedure
  .use(rateLimit(RateLimits.MESSAGE_SEND))
  .input(...)
```

When the identifier comes from the input (for example an email address):

```ts
await enforceRateLimit(ctx.db, RateLimits.OTP_REQUEST_EMAIL, `email:${email}`);
```

Over the limit, both throw `TOO_MANY_REQUESTS` (HTTP 429).

The email-code sign-in at `/api/auth/callback/otp` is not a tRPC procedure; it
applies the same policies through `signInWithOtp` in `src/server/_lib/signup.ts`.

## Sign-in codes: who can be locked out by whom

Requesting a code (`otpRequestLimits`) and submitting one (`otpVerifyLimits`)
are each limited by a chain that is checked in order and stops at the first
refusal:

1. the client (IP) across all addresses;
2. this client for this address, per 15 minutes and per day;
3. the address across all clients, per 15 minutes and per day.

The limits a person can meet are the ones keyed on **address and client
together** (2). The address-wide ceilings (3) are three times higher or more,
and a client that is over one of its own limits is refused before the
shared counters are touched. So one client cannot use up an address's
allowance and lock its owner out; doing that takes several clients.

| | per client + address | address, all clients |
| --- | --- | --- |
| Request a code, 15 min | 5 | 15 |
| Request a code, day | 20 | 60 |
| Submit a code, 15 min | 10 | 30 |
| Submit a code, day | 30 | 100 |

Guesses against one account are bounded by the last row whatever else
happens: 100 a day from all clients together (a code also dies after 5
wrong guesses), which is a 1 in 10,000 chance per day against a 6-digit code.

## Related controls

- Sign-in codes carry their own attempt counter (`VerificationToken.attempts`):
  a code is invalidated after 5 verification attempts, independently of the
  rate limits above.
- tRPC mutations cannot be batched and query batches are capped at 10 calls
  (`src/server/api/requestGuards.ts`), so one HTTP request cannot multiply
  per-request limits.

## Tests

`src/server/_utils/rateLimit.test.ts` runs the limiter against a real SQLite
database, including a concurrency test.
