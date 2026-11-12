# Billing

Pro is a Stripe subscription. Stripe is the source of truth; the app keeps a
mirror of each user's subscription in the `Subscription` table and decides
access from that mirror.

| What | Where |
| --- | --- |
| Access rules (the one place state becomes access) | `src/server/_billing/entitlements.ts` |
| Stripe subscription → stored state; which of several subscriptions counts | `src/server/_billing/subscriptionState.ts` |
| Reading from Stripe and the guarded writes | `src/server/_billing/subscriptionStore.ts` |
| Webhook (events, status codes) and its HTTP shell | `src/server/_billing/webhook.ts`, `webhookRequest.ts`, `src/app/webhooks/stripe/route.ts` |
| Checkout and the billing portal | `src/server/_billing/checkout.ts` |
| Client, pinned API version, configuration guards | `src/server/_billing/stripe.ts` |
| tRPC procedures | `src/server/api/routers/subscription.ts` |

## How the mirror is kept

- A webhook event only says **which** subscription changed. Its state is then
  read from the Stripe API (`latest_invoice` expanded) and stored. Event
  bodies are never trusted for state, so events may arrive late, twice or in
  any order.
- Every write is one conditional statement (D1 has no transactions). A
  reading replaces the stored one only if it is newer on Stripe's clock
  (`stripeSyncedAt`, from the response's `Date` header); that timestamp never
  moves backwards. Two different readings from the same second cannot be
  ordered, so the subscription is read again once that second has passed.
- A user has one row. If a reading is for a different subscription than the
  row shows, the row is re-derived from the customer's complete subscription
  list (all that are not cancelled, following pagination, plus the most
  recent cancelled ones) using the precedence below.
- A user is matched to a Stripe customer by the customer id stored on the
  user when checkout starts, else by `metadata.userId` (which only this
  server writes). Never by email address.

### Which subscription counts (precedence)

When a customer has more than one subscription, the row shows the one with
the highest precedence; among equals, the most recently created.

1. `active`, `trialing`, `past_due`
2. `canceled` on request with paid time left
3. `incomplete`, `unpaid`, `paused`, or a status this release does not know
4. `canceled` without paid time left, `incomplete_expired`

So a second, `incomplete` subscription never displaces one that is paid for.
More than one live subscription on a customer is reported as an error.

## Access table

`entitlementsFor` in `entitlements.ts`. Rules are applied top to bottom; the
first that matches decides.

| # | Condition | Pro access | Until |
| --- | --- | --- | --- |
| 1 | Comped account (`isLifetime`) | Yes | Open-ended; nothing below applies |
| 2 | A dispute is **open** on a payment of the subscription (any status) | **No** | The dispute is closed |
| 3 | The payment of the **current** period's invoice was **lost** to a dispute (any status) | **No** | A later invoice is paid |
| 4 | `active` | Yes | Open-ended; if set to cancel, until `cancelAt`, and **no** from that moment on even if Stripe's cancellation event has not arrived |
| 5 | `trialing` | Yes | As `active` |
| 6 | `past_due` | Yes, for **21 days from when it first became past due** (`pastDueSince`) | `pastDueSince` + 21 days. No anchor stored: **no** |
| 7 | `canceled`, reason `cancellation_requested`, current period **paid** (`paidThroughAt` in the future) and that payment not refunded in full | Yes | `paidThroughAt` (the end of the period paid for) |
| 8 | `canceled` otherwise (non-payment, dispute, period unpaid, period over, payment refunded in full) | No | |
| 9 | `unpaid` | No | |
| 10 | `paused` | No | |
| 11 | `incomplete` | No | |
| 12 | `incomplete_expired` | No | |
| 13 | Any status this release does not know | No (and reported as an error when stored) | |
| 14 | No subscription row | No | |

The rules behind the columns the status alone does not explain:

- **Paid period** (`paidThroughAt`, `latestInvoiceId`). The end of the
  current period is stored as `paidThroughAt` only when the subscription's
  latest invoice is `paid`. A renewal whose payment failed has an open
  latest invoice, so if the customer then cancels immediately (reason
  `cancellation_requested`, period end up to a year away) nothing is granted.
  When the latest invoice is an unpaid invoice for something else (a
  mid-period plan change), the period also counts as unpaid: the rule errs
  towards no access.
- **Grace** (`pastDueSince`). Set when the subscription is first seen
  `past_due` (to the creation time of the unpaid invoice, never later than
  the reading), kept for as long as it stays `past_due`, including across
  new billing periods, and cleared when it leaves that status. A new period
  opening while still past due therefore does not start another 21 days, and
  a `past_due` row without the anchor has no access. `PAST_DUE_GRACE_DAYS`
  must be at least as long as the retry schedule configured in Stripe.
- **Disputes** (`disputeId`, `disputeStatus`, `disputeInvoiceId`). A
  chargeback suspends access at once, whatever the subscription's status,
  until it is closed. Won (or withdrawn, or prevented): access returns.
  Lost: the invoice that charge paid counts as unpaid, so there is no access
  until a later invoice is paid. An *inquiry* (`warning_*` statuses) takes no
  money and does not suspend; if it escalates, `charge.dispute.updated`
  brings the new status. Limitation: one dispute is tracked per
  subscription; with two open at once, the row follows the most recent.
- **Refunds** (`refundedInvoiceId`). A **full** refund of the payment of the
  current period's invoice ends the paid-period entitlement of a
  **cancelled** subscription (rule 7 becomes rule 8). It does not remove
  access from a subscription that is still `active`: refunding without
  cancelling is the merchant's decision to keep it running. To end access
  for a refunded customer, cancel the subscription (refund and cancel, in
  either order). A partial refund changes nothing; a refund that is reversed
  restores the period.

What the client is told is `subscription.getStatus` (`SubscriptionView`):
`hasProAccess`, `accessEndsAt`, `canStartCheckout`, and `billingIssue`
(`payment_failed`, `disputed`, `paused`, `incomplete`, `unknown_status`).
When a subscription exists and `canStartCheckout` is false, the client offers
the billing portal, whether or not there is access: that is where a failed
payment is fixed and a paused or unfinished subscription is resumed or ended.

## Events handled

`HANDLED_EVENT_TYPES` in `webhook.ts`. Subscribe the endpoint to exactly
these; anything else is acknowledged and ignored.

| Event | What happens |
| --- | --- |
| `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` | The customer is linked to the user; the session's subscription is read and stored |
| `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed` | The subscription is read and stored |
| `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed` | The invoice's subscription is read and stored (this is what sets and clears `paidThroughAt` and `pastDueSince`) |
| `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` | The dispute is read from Stripe, traced to its subscription (charge → payment intent → invoice payment → invoice → subscription), and its standing recorded |
| `charge.refunded` | The charge is read from Stripe and traced the same way; a full refund is recorded, anything else clears the marker |
| `customer.deleted` | The customer id is forgotten and the row ended |

Responses: `200` handled, duplicate, ignored, or about a customer that is not
a user (logged; a retry could not help). `400` missing or invalid signature,
before the body is read when the header is absent. `413` body over 1 MB
(refused from `Content-Length`, or while reading when that header is absent
or wrong). `409` the same event is being handled right now. `500` a
transient failure, or `STRIPE_WEBHOOK_SECRET` is not set (reported once);
Stripe retries.

## Stripe dashboard setup

Do all of this once in test mode and once in live mode; ids differ.

### Product and prices

One product, "ISO Pro", with **four recurring prices** (USD, licensed,
quantity 1). Put each price's id (`price_...`, "Copy price ID") in the
variable shown. The amounts must match what the app displays
(`getPricingForRole` in `src/server/_utils/pricing.ts`).

| Price | Amount | Billing period | Variable |
| --- | --- | --- | --- |
| Founding, monthly | $10 | Monthly | `STRIPE_FOUNDING_MONTHLY_PRICE_ID` |
| Founding, annual | $99 | Yearly | `STRIPE_FOUNDING_ANNUAL_PRICE_ID` |
| Standard, monthly | $19 | Monthly | `STRIPE_STANDARD_MONTHLY_PRICE_ID` |
| Standard, annual | $179 | Yearly | `STRIPE_STANDARD_ANNUAL_PRICE_ID` |

Which list a user buys from is decided on the server from their role
(founding member, founder, ambassador: founding; everyone else: standard).
A plan whose variable is empty cannot be bought: checkout answers "billing
unavailable" and creates nothing at Stripe.

Set them with `wrangler secret put <NAME>` (or as vars) for staging and
production, in `.dev.vars` for `wrangler dev`, and in `.env` for `next dev`;
`.env.example` and `.dev.vars.example` list them.

### Webhook endpoint

- URL: `https://<app origin>/webhooks/stripe`
- **API version: `2026-10-28.endive`** (`STRIPE_API_VERSION` in
  `stripe.ts`). Stripe renders events with the *endpoint's* version; an
  endpoint on another version sends objects this code does not parse
  correctly. When the `stripe` package is upgraded, change the constant and
  the endpoint's version in the same release.
- Events: the sixteen in the table above, namely
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `customer.subscription.paused`, `customer.subscription.resumed`,
  `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`,
  `charge.dispute.created`, `charge.dispute.updated`,
  `charge.dispute.closed`, `charge.refunded`, `customer.deleted`.
- Put the endpoint's signing secret (`whsec_...`) in `STRIPE_WEBHOOK_SECRET`.

### Customer portal (Settings → Billing → Customer portal)

- Payment methods: customers can update them. **On.**
- Invoice history: **on.**
- Cancel subscriptions: **on**, mode "at the end of the billing period"
  (an immediate cancellation also works: access then lasts until the end of
  the period already paid for, rule 7).
- Switch plans: **off.** The portal would offer every price of the product,
  including the founding prices to people who are not entitled to them.
- Pause subscriptions: off, unless wanted; a paused subscription has no
  access (rule 10) and is resumed in the portal.
- Default return URL: `https://<app origin>/app/settings`.

### Failed payments (Billing → Revenue recovery → Retries)

- Smart Retries: **8 retries within 2 weeks** (Stripe's recommended
  schedule). Any schedule works as long as it ends within
  `PAST_DUE_GRACE_DAYS` (21 days); if you choose the 3-week schedule or
  longer, raise that constant first.
- If all retries fail: **cancel the subscription** (recommended). "Mark as
  unpaid" also ends access (rule 9). "Leave past-due" is safe too, since
  access still ends 21 days after the first failure (rule 6), but the
  subscription then stays live at Stripe and the customer has to fix or
  cancel it in the portal before they can subscribe again.
- Disputes (Billing → Subscriptions and emails → Manage disputed payments):
  either setting works with the rules above. "Cancel the subscription
  immediately" is the simpler one to reason about.

## After deploying this release (one-time)

Migration `0003` back-fills `status` from the legacy flags as well as it
can, but those flags cannot say what Stripe knows (whether the period was
paid, since when a subscription is past due), and rows the previous release
writes while both releases are serving get only the flags. Every row that
has a Stripe subscription must therefore be read from Stripe once.

Order:

1. Apply the migration (`npm run db:migrate:production`). The previous
   release keeps working: nothing it uses is removed.
2. In the Stripe dashboard, set the webhook endpoint's API version and
   event list as above.
3. Deploy the new release, with the four price ids set.
4. Once the previous release is no longer serving any traffic, run the
   re-sync. Running it earlier is harmless but must then be repeated, since
   the previous release may still write rows.

```sh
RESYNC_COOKIE='<session cookie of a founder or ambassador>' \
  node scripts/billing-resync.mjs --url https://<app origin>
```

The script calls the admin procedure `subscription.resyncFromStripe` in
batches of up to 10 rows until nothing is left, and prints the outcome of
each batch. It can be interrupted and run again at any time: each row is
brought up to date by the same idempotent sync the webhook uses, and a row
that fails (Stripe unavailable) is counted, skipped, and picked up by the
next run. The default scope, `pending`, covers rows that were never read
from Stripe (`stripeSyncedAt IS NULL`) and rows whose legacy flags
contradict their `status` (written by the previous release during the
overlap); `--scope all` revisits every row with a Stripe subscription or
customer.

Outcomes: `applied` (row now mirrors Stripe), `stale` (it already did),
`nothing_at_stripe` (the customer has no subscriptions), `subscription_missing`
(the row names a subscription Stripe does not have, for example test data;
reported), `unknown_customer`, `failed`.

**`unknown_customer`**: the row has a subscription id but its user has no
stored Stripe customer id, and the subscription's `metadata.userId` does not
name them either. The previous release matched such rows by email, which
proves nothing about ownership, so the re-sync deliberately leaves them as
the migration back-filled them and does not link them. Count them before
you start:

```sql
SELECT COUNT(*)
FROM "Subscription" s
JOIN "User" u ON u."id" = s."userId"
WHERE s."subscriptionId" IS NOT NULL
  AND s."stripeSyncedAt" IS NULL
  AND u."stripeId" IS NULL;
```

(`wrangler d1 execute DB --remote --env="" --command "..."`). For each,
look the subscription up in Stripe, confirm the customer really is that
user, and then either store the customer id on the user
(`UPDATE "User" SET "stripeId" = 'cus_...' WHERE "id" = '...'`) and run the
script again. Do not leave such a row: nothing corrects it later (starting
checkout creates a new, empty Stripe customer and is then refused because a
subscription row already exists), so it keeps the access the migration
back-filled. If the subscription cannot be confirmed as that user's, set the
row's `status` to `canceled` by hand so it stops granting access.

To see what is still pending afterwards:

```sql
SELECT "status", COUNT(*) FROM "Subscription"
WHERE "stripeSyncedAt" IS NULL AND "subscriptionId" IS NOT NULL
GROUP BY "status";
```

## Testing locally with the stub

`src/test/helpers/stripeStub.ts` is a small HTTP server that stands in for
the Stripe API. The real Stripe SDK talks to it, so request encoding, error
mapping and response parsing are exercised; only Stripe's servers are
replaced. It holds customers, subscriptions, invoices, invoice payments,
charges, disputes and Checkout sessions in memory, in the shapes of the
pinned API version.

- **Unit and router tests** (`npm test`) start their own stub; nothing to
  configure. See `src/server/_billing/*.test.ts` and
  `src/server/api/routers/subscription.test.ts` for how objects are put into
  it (`buildSubscription`, `buildInvoice`, `buildDispute`, ...) and how
  signed webhook deliveries are made (`buildEvent`, `signEvent`).
- **Against a running app** (`next dev` or `wrangler dev`): start the stub
  on a port (`startStripeStub({ port })` from a small `tsx` script), and
  point the app at it with `STRIPE_API_BASE_URL=http://127.0.0.1:<port>`,
  any `sk_test_...` key, a `STRIPE_WEBHOOK_SECRET` of your choosing (sign the
  events you post to `/webhooks/stripe` with the same one), and the four
  price ids set to the stub's (`price_standard_monthly`, ...).

`STRIPE_API_BASE_URL` is test-only. It is accepted only for loopback
addresses, and refused outright (the Stripe client throws) in a production
deployment: a live-mode key, or a public base URL (`NEXT_PUBLIC_BASE_URL`)
that is not this machine. Never set it in staging or production.

To test against real Stripe instead, use test-mode keys and
`stripe listen --forward-to localhost:3000/webhooks/stripe` (the CLI prints
the signing secret to use), with the endpoint API version pinned as above.
