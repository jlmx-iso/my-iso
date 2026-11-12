# Billing

Pro is a Stripe subscription. Stripe is the source of truth; the app keeps a
mirror of each user's subscription in the `Subscription` table and decides
access from that mirror.

| What | Where |
| --- | --- |
| Access rules (the one place state becomes access) | `src/server/_billing/entitlements.ts` |
| Stripe subscription → stored state; which of several subscriptions counts | `src/server/_billing/subscriptionState.ts` |
| Reading from Stripe and the guarded writes | `src/server/_billing/subscriptionStore.ts` |
| Disputes and refunds, derived from Stripe; the set of known disputes | `src/server/_billing/paymentStanding.ts`, table `SubscriptionDispute` |
| Leases (one sequence per customer / per user at a time) | `src/server/_billing/lease.ts` |
| First sync of a legacy row on an access check | `src/server/_billing/lazySync.ts` |
| Webhook (events, status codes) and its HTTP shell | `src/server/_billing/webhook.ts`, `webhookRequest.ts`, `src/app/webhooks/stripe/route.ts` |
| Checkout and the billing portal | `src/server/_billing/checkout.ts` |
| Client, pinned API version, configuration guards | `src/server/_billing/stripe.ts` |
| tRPC procedures | `src/server/api/routers/subscription.ts` |

## How the mirror is kept

- A webhook event only says **which** subscription changed. Its state is then
  read from the Stripe API (`latest_invoice` expanded) and stored. Event
  bodies are never trusted for state, so events may arrive late, twice or in
  any order.
- Every read-then-store sequence (a webhook event, checkout's refresh,
  `syncStatus`, the re-sync, the lazy first sync) runs under a **lease per
  Stripe customer** (`BillingLease`, key `customer:<id>`), so two readings
  for one customer are taken and stored one after the other. A webhook that
  cannot get the lease within 3.5 seconds answers `409` and is redelivered.
  Waiting backs off (150 ms doubling to one second), so a waiter costs about
  seven D1 statements. Leases and claims that expired more than an hour ago
  are swept now and then when a lease is taken.
- Every write is also one conditional statement (D1 has no transactions),
  which is what still holds if a holder outlives its lease. A reading
  replaces the stored one only if it is newer on Stripe's clock
  (`stripeSyncedAt`, from the response's `Date` header); that timestamp never
  moves backwards. Two readings from the same second cannot be ordered: one
  is accepted only if it equals the stored one in **every** field read from
  Stripe, and otherwise (including a reading that would switch the row to
  another subscription) the subscription is read again once that second has
  passed.
- A user has one row. If a reading is for a different subscription than the
  row shows, the row is re-derived from the customer's complete subscription
  list (everything that is not cancelled and everything that is, following
  pagination to the end) using the precedence below.
- **A partial list decides nothing.** If a customer has more subscriptions
  than are read (five pages of 100, of either kind), nothing is stored from
  what was read, it is reported, and the outcome is `listing_truncated`:
  not "this is the primary", and not "there is none". Checkout is refused
  ("billing unavailable") rather than risk a second subscription.
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
| 3 | The most recent **paid** invoice was **lost** to a dispute (any status, `past_due` and its grace included) | **No** | A later invoice is **paid** (issued is not enough) |
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
- **Disputes and refunds are derived, not accumulated**
  (`paymentStanding.ts`; columns `disputeId`, `disputeStatus`,
  `disputeInvoiceId`, `refundedInvoiceId`). A dispute, refund or invoice
  event only says that a subscription's standing may have changed. The
  standing is then computed from what Stripe has at that moment (the
  customer's charges, the disputes on those that are disputed, the
  subscription's invoices and the payments of its latest one) and stored
  whole, in a statement that also requires the customer's lease to be held
  still. So events may arrive late, twice or in any order; two disputes open
  at once are both seen, and winning one does not hide the other; and
  nothing depends on which event was handled last. `subscription.syncStatus`
  derives it too, so a customer can put a stale standing right from the
  settings page if an event is late.
- **Every dispute is remembered until Stripe says it is over**
  (table `SubscriptionDispute`, keyed by dispute id, per Stripe
  subscription). Whatever a derivation learns of, from an event's own
  charge or from the listing, is upserted there (one statement each, under
  the customer's lease) and never deleted. Its `status` is `open`,
  `inquiry` (no money taken yet; can still become a chargeback), `lost`,
  `superseded` (lost, and a later invoice has been paid for) or `cleared`
  (won, withdrawn, closed, or gone at Stripe). A dispute that is `open` or
  `inquiry` is **re-read from Stripe by its id in every derivation**; a
  `lost` one is final at Stripe and is carried until superseded. The
  standing is the worst across all of them: any `open` withholds access;
  otherwise a `lost` one on the most recent invoice paid for does. So a
  dispute stops withholding only on a direct read of that dispute, never
  because a later derivation could not see its charge, and it makes no
  difference how many disputes there are, in which order they open and
  close, or which event triggers the derivation (an invoice event, another
  dispute, the re-sync, the manual refresh). `disputeId`, `disputeStatus`
  and `disputeInvoiceId` on `Subscription` are the summary of that set,
  written with each derivation, so an access check needs no join.
  The refund marker needs no memory: the charges that paid the latest
  invoice are read directly when the listing does not hold them.
- **One derivation is bounded** (at most 28 Stripe requests), and no bound
  restores access:
  - **More than ten known disputes still unfinished**: ten are re-read; the
    others keep their stored status, so an open one still withholds, and
    the row is reported (`standing_incomplete`). They are read the next
    time.
  - **More than 300 charges** on the customer: the standing is derived from
    the newest 300 **plus the charge a dispute or refund event is about**,
    which is read directly by its payment intent whatever its age. So for
    such a customer too, a new dispute is recorded and a won one clears. If
    charges of the last two years were left unread, the result is marked
    incomplete: the event answers `standing_incomplete` (200; a retry would
    read the same), the re-sync lists the row under `unresolved`, and it is
    reported with the `Subscription` id. What could be missed is a dispute
    on one of the unread charges whose events were all lost.
  - **More than five disputed charges in the last two years**: the event's
    own and the newest are examined, five in all. If one of them withholds
    access, that is the standing. If none does, the others were not looked
    at and may be open, so it **fails closed**: `disputeStatus` is `open`
    with no `disputeId`, access is withheld, and the row is reported as
    above for a person to review. It lifts by itself when the disputed
    charges age past two years; until then the override is a comped
    account (`isLifetime`). Disputed charges older than two years are
    history and are ignored.
- **Disputes.** A chargeback suspends access at once, whatever the
  subscription's status and whichever of its invoices the charge paid, until
  it is closed. Won (or withdrawn, or prevented): access returns. Lost, on
  the most recent paid invoice: nothing that was paid for stands behind the
  subscription any more, so there is no access until a later invoice is
  **paid for** (`paid` with `amount_paid` above zero). A renewal that is only
  issued, or whose payment fails (`past_due`), does not lift it: there is no
  grace window on top of a lost payment. Neither does an invoice that is
  `paid` without money (a trial, a credit, a proration that came to nothing). A loss on an older invoice, with a later one already paid,
  withholds nothing. An *inquiry* (`warning_*` statuses) takes no money and
  does not suspend; if it escalates, `charge.dispute.updated` brings the new
  status.
- **Refunds.** A **full** refund of the payment of the latest invoice ends
  the paid-period entitlement of a **cancelled** subscription (rule 7
  becomes rule 8). It does not remove access from a subscription that is
  still `active`: refunding without cancelling is the merchant's decision to
  keep it running. To end access for a refunded customer, cancel the
  subscription (refund and cancel, in either order). A partial refund
  changes nothing. A refund that **fails** or is cancelled after the fact
  (`refund.failed`, `refund.updated`) puts the amount back on the charge, the
  charge is then no longer refunded in full, and the period is restored. A
  refund of an older invoice says nothing about the latest one.

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
| `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed` | The invoice's subscription is read and stored (this is what sets and clears `paidThroughAt` and `pastDueSince`), and its payment standing derived again (a paid invoice is what ends a lost dispute's hold) |
| `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` | The event's payment intent is traced to its subscription (payment intent → invoice payment → invoice → subscription); the subscription is read and stored and its whole payment standing derived from Stripe |
| `charge.refunded`, `charge.refund.updated`, `refund.updated`, `refund.failed` | The same: traced by payment intent, then the standing is derived (is the latest invoice's payment refunded in full *now*?) |
| `customer.deleted` | The customer id is forgotten and the row ended |

Responses: `200` handled, duplicate, ignored, or about a customer that is not
a user (logged; a retry could not help). `400` missing or invalid signature,
before the body is read when the header is absent. `413` body over 1 MB
(refused from `Content-Length`, or while reading when that header is absent
or wrong). `409` the same event is being handled right now, or another
event for the same customer is (`busy`). `500` a
transient failure, or `STRIPE_WEBHOOK_SECRET` is not set (reported once);
Stripe retries.

## Platform limits this is sized for

The app runs on the **Workers Paid** plan (its bundle is over the Free
plan's size limit). What the billing code assumes from it:

| Limit | Value | Where it matters |
| --- | --- | --- |
| Subrequests per invocation (every `fetch`, so every Stripe request, and every D1 statement) | 10,000 by default on Paid (`limits.subrequests` in `wrangler.toml` can change it); 50 external on Free | A re-sync batch is held to **1,000** (`SUBREQUEST_BUDGET` in `resync.ts`): at the very worst a row costs 63 Stripe requests and 50 statements, so `RESYNC_MAX_BATCH` is 8. A row normally costs four or five requests. One webhook delivery is a few reads plus at most 28 for the payment standing. The Free plan would not carry a batch. |
| Work after the response (`waitUntil`) | 30 seconds | A lazy first sync that outlives its budget finishes there; its Stripe calls are limited to 3 seconds each for that reason. |

If `limits.subrequests` is ever set below 1,000, lower `SUBREQUEST_BUDGET`
with it; the batch size follows (a test holds the arithmetic).

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
- Events: the nineteen in the table above, namely
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `customer.subscription.paused`, `customer.subscription.resumed`,
  `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`,
  `charge.dispute.created`, `charge.dispute.updated`,
  `charge.dispute.closed`, `charge.refunded`, `charge.refund.updated`,
  `refund.updated`, `refund.failed`, `customer.deleted`.
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
2. **Cutover, steps 2a and 2b back to back.** Have the new release built
   and ready before starting; the time between the two is the cutover
   window, and it should be minutes.
   - **2a.** In the Stripe dashboard, set the webhook endpoint's API version
     and event list as above.
   - **2b.** Deploy the new release, with the four price ids set.
3. Once the previous release is no longer serving any traffic, run the
   re-sync. Running it earlier is harmless but must then be repeated, since
   the previous release may still write rows.

### The cutover window

There is one URL and one endpoint, so for a moment one of the two releases
receives events rendered in the API version of the other. With the order
above it is the **previous** release that does, between 2a and the moment
2b has replaced it everywhere:

- It reads `invoice.subscription` and `subscription.current_period_end`,
  which the new API version does not send. Its handlers do not fail (Stripe
  sees `200`, nothing is retried); they **store null**: `subscriptionId` and
  `expiresAt` on `invoice.payment_succeeded`, `expiresAt` on
  `customer.subscription.created` / `.updated`. It still writes its
  `isActive` flag correctly, from the status.
- So what is wrong during the window is stored values, on the rows of
  customers who had a billing event in those minutes: a row that has lost
  its subscription id or its expiry date. Decisions made from such a row
  can be wrong until it is repaired: by the previous release for as long as
  it still serves (whatever it derives from `expiresAt`), and by the new
  release if it reads the row before repairing it.
- Repair is by reading Stripe again, and needs no event to arrive:
  - the **re-sync** (step 3) selects exactly these rows: its `pending`
    scope covers a null `subscriptionId` and a null `expiresAt` next to a
    known period end, besides rows never read from Stripe and rows whose
    legacy flags contradict their `status`
    (`resyncScopeFilter`; the test "repairs rows the previous release wrote
    after the endpoint's API version changed" in
    `src/server/api/routers/subscription.test.ts` holds it to that);
  - and each such row also repairs **itself** the first time the new
    release decides access on it (below), so a customer who shows up before
    the re-sync has run is not judged on the nulled row.
- The window is closed when the re-sync has run to the end with exit code
  0 after the previous release stopped serving. Until then, treat stored
  billing state as provisional.

The other order (deploy first, change the endpoint afterwards) was not
chosen: the new release would receive invoice events in the old rendering,
find no `parent` on them, and acknowledge them as "not a subscription".
Those are lost without a trace, where the order above leaves rows that are
recognisably in need of repair.

### Lazy first sync

A row that has never been read from Stripe (`stripeSyncedAt IS NULL`), or
that lost its `subscriptionId` / `expiresAt` in the cutover window, is read
from Stripe the first time access is decided on it (`proProcedure`,
`subscription.getStatus`): `loadSubscriptionForAccess` in `lazySync.ts`.
The rule:

- It never fails the request and takes at most 5 seconds. If Stripe cannot
  be reached in that time, or gives an answer that does not settle the row
  (`unknown_customer`, `subscription_missing`, `listing_truncated`, or
  nothing at Stripe for a row that grants access), **the decision is made
  from the row as stored**: what the migration back-filled, which is what
  the previous release decided. Access is neither granted nor taken away on
  a guess.
- It does not queue behind other billing work. It waits at most one second
  for the customer's lease; a busy lease means a webhook, checkout or the
  re-sync is reading that customer right now, so the stored row is used and
  the row is looked at again 30 seconds later.
- A sync that outlives the 5 seconds is not abandoned while holding the
  customer's lease (which would make that customer's webhooks answer 409
  until the lease expired). It is handed to `waitUntil`
  (`runAfterResponse`), and it uses a Stripe client whose calls give up
  after 3 seconds without retrying (`getAccessCheckStripe`), so it finishes
  and releases the lease well inside the 30 seconds Workers allow after a
  response. If the isolate dies anyway, the lease expires after 90 seconds.
- It is attempted at most once per 10 minutes per row, across all isolates
  (a claim in `BillingLease`, key `first-sync:<Subscription id>`). After
  **any** answer from Stripe that leaves the row still qualifying (nothing
  at Stripe for it, an unknown customer, ...) the next attempt is 24 hours
  away, whether or not access is at stake: the same question would get the
  same answer.
- A row that is not settled is reported through `reportBillingError` with
  its `Subscription` id and the outcome.

It does not replace the re-sync: rows of users who never come back are only
reached by the script.

### Running the re-sync

```sh
RESYNC_COOKIE='<session cookie of a founder or ambassador>' \
  node scripts/billing-resync.mjs --url https://<app origin>
```

The script calls the admin procedure `subscription.resyncFromStripe` in
batches of up to 8 rows (`RESYNC_MAX_BATCH`; the script lets the server choose unless `--limit` is given) until nothing is left, and prints the outcome of
each batch. It can be interrupted and run again at any time: each row is
brought up to date by the same idempotent sync the webhook uses, and a row
that fails (Stripe unavailable) is counted, skipped, and picked up by the
next run. Each row's payment standing (disputes, refunds) is derived along
with it. The default scope, `pending`, covers rows that were never read
from Stripe (`stripeSyncedAt IS NULL`), rows whose legacy flags contradict
their `status`, and rows with a null `subscriptionId` or a null `expiresAt`
next to a known period end (all three written by the previous release
during the overlap); `--scope all` revisits every row with a Stripe
subscription or customer.

**Exit code.** `0`: every batch ran and every row is settled. `1`: a batch
could not be run, or at least one row `failed`; the re-sync is **not**
complete, run it again. `3`: nothing failed, but rows are left that need a
person; their `Subscription` ids and outcomes are printed (and returned by
the procedure as `unresolved`). A deployment job must not continue on
anything but `0`.

Outcomes: `applied` (row now mirrors Stripe), `stale` (it already did),
`nothing_at_stripe` (the customer has no subscriptions; unresolved only if
the row still grants access, in which case nothing was changed: look at it),
`subscription_missing` (the row names a subscription Stripe does not have,
for example test data; reported), `listing_truncated` (more subscriptions
than are read; nothing stored), `unknown_customer`, `failed`. A row can
also be listed as unresolved with `standing_incomplete` although its
outcome was `applied`: it is up to date, but its payment standing was
derived from an incomplete history (see "Disputes and refunds are derived").

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

To see what is still pending afterwards (the second query: rows the
previous release left without a subscription id, on users without a stored
customer, which nothing can look up and the re-sync therefore does not
select; resolve them by hand the same way):

```sql
SELECT "status", COUNT(*) FROM "Subscription"
WHERE NOT "isLifetime"
  AND ("stripeSyncedAt" IS NULL OR "subscriptionId" IS NULL
       OR ("expiresAt" IS NULL AND "currentPeriodEnd" IS NOT NULL))
GROUP BY "status";

SELECT s."id", s."status" FROM "Subscription" s
JOIN "User" u ON u."id" = s."userId"
WHERE NOT s."isLifetime" AND s."subscriptionId" IS NULL AND u."stripeId" IS NULL
  AND s."status" IN ('active', 'trialing', 'past_due');
```

## Testing locally with the stub

`src/test/helpers/stripeStub.ts` is a small HTTP server that stands in for
the Stripe API. The real Stripe SDK talks to it, so request encoding, error
mapping and response parsing are exercised; only Stripe's servers are
replaced. It holds customers, subscriptions, invoices, invoice payments,
charges, disputes and Checkout sessions in memory (with the listings the
payment standing reads: charges by customer, disputes by charge, invoices
by subscription, invoice payments by invoice), in the shapes of the
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
