# MY-ISO Implementation Plan

**Created**: 2025-12-27
**Purpose**: Detailed implementation plan for completing features and resolving issues identified in codebase audit

---

## Table of Contents

1. [Critical Features](#1-critical-features)
2. [Medium Priority Features](#2-medium-priority-features)
3. [Bug Fixes](#3-bug-fixes)
4. [Dependency Issues](#4-dependency-issues)
5. [Code Quality Improvements](#5-code-quality-improvements)
6. [Security Enhancements](#6-security-enhancements)

---

# 1. CRITICAL FEATURES

## 1.1 Stripe Payment Integration

**Status**: 40% Complete (database models exist, webhook stub created)
**Priority**: Critical
**Estimated Effort**: 8-12 hours
**Files to Modify**: 6-8 files

### Current State
- ✅ Stripe SDK installed (v14.25.0)
- ✅ Database `Subscription` model exists
- ✅ User model has `stripeId` field
- ✅ Environment variables configured
- ⚠️ Webhook handler incomplete (`WIProute.ts`)
- ❌ No checkout flow
- ❌ No subscription tRPC router
- ❌ Pricing page buttons non-functional

### Implementation Steps

#### Step 1: Create Subscription tRPC Router (2 hours)
**File**: `src/server/api/routers/subscription.ts` (NEW)

```typescript
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import Stripe from "stripe";
import { env } from "~/env";

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

export const subscriptionRouter = createTRPCRouter({
  // Create Stripe checkout session
  createCheckoutSession: protectedProcedure
    .input(z.object({
      priceId: z.string(), // Stripe price ID (pro plan)
      successUrl: z.string().url(),
      cancelUrl: z.string().url(),
    }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user;

      // Get or create Stripe customer
      let stripeCustomerId = user.stripeId;

      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { userId: user.id },
        });

        // Update user with stripe ID
        await ctx.db.user.update({
          where: { id: user.id },
          data: { stripeId: customer.id },
        });

        stripeCustomerId = customer.id;
      }

      // Create checkout session
      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });

      return { sessionId: session.id, url: session.url };
    }),

  // Get current subscription
  getCurrentSubscription: protectedProcedure
    .query(async ({ ctx }) => {
      return ctx.db.subscription.findUnique({
        where: { userId: ctx.session.user.id },
      });
    }),

  // Create customer portal session (for managing subscription)
  createPortalSession: protectedProcedure
    .input(z.object({ returnUrl: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.session.user.id },
      });

      if (!user?.stripeId) {
        throw new Error("No Stripe customer found");
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeId,
        return_url: input.returnUrl,
      });

      return { url: session.url };
    }),
});
```

**Action Items**:
- [ ] Create file
- [ ] Add price IDs to environment variables (NEXT_PUBLIC_STRIPE_PRICE_ID_PRO)
- [ ] Export router in `src/server/api/root.ts`

#### Step 2: Complete Webhook Handler (3 hours)
**File**: `src/app/webhooks/stripe/route.ts` (RENAME from WIProute.ts)

```typescript
import { type NextRequest } from "next/server";
import Stripe from "stripe";
import { env } from "~/env";
import { db } from "~/server/db";
import { logger } from "~/_utils";

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return new Response("No signature", { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.error("Webhook signature verification failed", { error: err });
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  try {
    switch (event.type) {
      case 'customer.created':
      case 'customer.updated':
        await handleCustomerUpdate(event.data.object as Stripe.Customer);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        logger.info("Unhandled webhook event", { type: event.type });
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    logger.error("Webhook handler error", { error: err, type: event.type });
    return new Response("Webhook handler failed", { status: 500 });
  }
}

async function handleCustomerUpdate(customer: Stripe.Customer) {
  if (!customer.email) return;

  await db.user.update({
    where: { email: customer.email },
    data: { stripeId: customer.id },
  });
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const user = await db.user.findUnique({
    where: { stripeId: subscription.customer as string },
  });

  if (!user) {
    logger.error("User not found for subscription", { customerId: subscription.customer });
    return;
  }

  const isActive = subscription.status === 'active';
  const isTrial = subscription.status === 'trialing';
  const isCanceled = subscription.cancel_at_period_end;
  const isPaused = subscription.pause_collection !== null;
  const expiresAt = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;

  await db.subscription.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      subscriptionId: subscription.id,
      isActive,
      isTrial,
      isCanceled,
      isPaused,
      isPending: false,
      isExpired: false,
      isLifetime: false,
      expiresAt,
    },
    update: {
      subscriptionId: subscription.id,
      isActive,
      isTrial,
      isCanceled,
      isPaused,
      isExpired: false,
      expiresAt,
    },
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const user = await db.user.findUnique({
    where: { stripeId: subscription.customer as string },
  });

  if (!user) return;

  await db.subscription.update({
    where: { userId: user.id },
    data: {
      isActive: false,
      isCanceled: true,
      isExpired: true,
    },
  });
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  logger.info("Payment succeeded", {
    customerId: invoice.customer,
    amount: invoice.amount_paid
  });
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  logger.error("Payment failed", {
    customerId: invoice.customer,
    attemptCount: invoice.attempt_count
  });
}

export { POST as GET }; // Remove this if only POST is needed
```

**Action Items**:
- [ ] Rename `WIProute.ts` to `route.ts`
- [ ] Implement webhook handler functions
- [ ] Test with Stripe CLI: `stripe listen --forward-to localhost:3000/webhooks/stripe`
- [ ] Configure webhook endpoint in Stripe Dashboard

#### Step 3: Update Pricing Page (2 hours)
**File**: `src/app/pricing/page.tsx`

Add checkout button functionality:

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '~/trpc/react';
import { env } from '~/env';

export default function PricingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const createCheckout = api.subscription.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error) => {
      alert('Failed to start checkout: ' + error.message);
      setLoading(false);
    },
  });

  const handleUpgrade = () => {
    setLoading(true);
    createCheckout.mutate({
      priceId: env.NEXT_PUBLIC_STRIPE_PRICE_ID_PRO,
      successUrl: `${window.location.origin}/app/subscription/success`,
      cancelUrl: `${window.location.origin}/pricing`,
    });
  };

  return (
    // ... existing pricing UI
    <button onClick={handleUpgrade} disabled={loading}>
      {loading ? 'Loading...' : 'Upgrade to Pro'}
    </button>
  );
}
```

**Action Items**:
- [ ] Convert to client component
- [ ] Add checkout mutation
- [ ] Create success/cancel pages
- [ ] Add loading states

#### Step 4: Create Subscription Management Page (2 hours)
**File**: `src/app/app/subscription/page.tsx` (NEW)

```typescript
import { api } from '~/trpc/server';
import { SubscriptionCard } from './_components/SubscriptionCard';

export default async function SubscriptionPage() {
  const subscription = await api.subscription.getCurrentSubscription();

  return (
    <div>
      <h1>Your Subscription</h1>
      <SubscriptionCard subscription={subscription} />
    </div>
  );
}
```

**File**: `src/app/app/subscription/_components/SubscriptionCard.tsx` (NEW)

```typescript
'use client';

import { api } from '~/trpc/react';
import { Button } from '@mantine/core';

export function SubscriptionCard({ subscription }) {
  const createPortal = api.subscription.createPortalSession.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  const handleManage = () => {
    createPortal.mutate({
      returnUrl: window.location.href,
    });
  };

  if (!subscription || !subscription.isActive) {
    return <div>No active subscription</div>;
  }

  return (
    <div>
      <p>Status: {subscription.isActive ? 'Active' : 'Inactive'}</p>
      <p>Expires: {new Date(subscription.expiresAt).toLocaleDateString()}</p>
      <Button onClick={handleManage}>Manage Subscription</Button>
    </div>
  );
}
```

**Action Items**:
- [ ] Create subscription page
- [ ] Add subscription card component
- [ ] Add link in navigation

#### Step 5: Add Stripe Product/Price Setup (1 hour)

**In Stripe Dashboard**:
1. Create Product: "MY-ISO Pro"
2. Create Price: $10/month (recurring)
3. Copy Price ID to environment variables
4. Configure webhook endpoint

**Environment Variables to Add**:
```env
NEXT_PUBLIC_STRIPE_PRICE_ID_PRO=price_xxxxx
```

#### Step 6: Testing (2 hours)

**Test Cases**:
- [ ] User can start checkout from pricing page
- [ ] Stripe checkout session created successfully
- [ ] Payment completion triggers webhook
- [ ] Subscription created in database
- [ ] User can access subscription management
- [ ] Cancellation works via portal
- [ ] Webhook handles all subscription states

**Test with Stripe Test Cards**:
- Success: 4242 4242 4242 4242
- Decline: 4000 0000 0000 0002

---

## 1.2 Search Feature Implementation

**Status**: 0% Complete (placeholder page only)
**Priority**: Critical
**Estimated Effort**: 6-8 hours
**Files to Modify**: 4-6 files

### Current State
- ✅ Google Maps autocomplete router exists
- ✅ Event/photographer search endpoints exist
- ❌ No search UI
- ❌ No search results display

### Implementation Steps

#### Step 1: Create Search Router (1 hour)
**File**: `src/server/api/routers/search.ts` (NEW)

```typescript
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

export const searchRouter = createTRPCRouter({
  searchAll: publicProcedure
    .input(z.object({
      query: z.string().min(1),
      location: z.string().optional(),
      radius: z.number().optional(), // miles
      filters: z.object({
        type: z.enum(['photographers', 'events', 'all']).default('all'),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
      }).optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const { query, location, filters, limit, offset } = input;

      const results = {
        photographers: [],
        events: [],
      };

      // Search photographers
      if (!filters?.type || filters.type === 'all' || filters.type === 'photographers') {
        results.photographers = await ctx.db.photographer.findMany({
          where: {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { bio: { contains: query, mode: 'insensitive' } },
              { companyName: { contains: query, mode: 'insensitive' } },
              { location: location ? { contains: location, mode: 'insensitive' } : undefined },
            ],
          },
          take: limit,
          skip: offset,
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                profilePic: true,
              },
            },
          },
        });
      }

      // Search events
      if (!filters?.type || filters.type === 'all' || filters.type === 'events') {
        const dateFilter = filters?.dateFrom && filters?.dateTo ? {
          date: {
            gte: filters.dateFrom,
            lte: filters.dateTo,
          },
        } : {};

        results.events = await ctx.db.event.findMany({
          where: {
            isDeleted: false,
            ...dateFilter,
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
              { location: location ? { contains: location, mode: 'insensitive' } : undefined },
            ],
          },
          take: limit,
          skip: offset,
          include: {
            photographer: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
            _count: {
              select: {
                comments: true,
                eventLikes: true,
              },
            },
          },
        });
      }

      return results;
    }),
});
```

**Action Items**:
- [ ] Create search router
- [ ] Add to root router
- [ ] Test search queries

#### Step 2: Build Search UI (3 hours)
**File**: `src/app/app/search/page.tsx`

```typescript
'use client';

import { useState } from 'react';
import { TextInput, Button, Select, DatePickerInput, Stack, Tabs } from '@mantine/core';
import { IconSearch, IconMapPin } from '@tabler/icons-react';
import { api } from '~/trpc/react';
import { SearchResults } from './_components/SearchResults';

export default function SearchPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [location, setLocation] = useState('');
  const [searchType, setSearchType] = useState<'all' | 'photographers' | 'events'>('all');
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null]);

  const { data: results, isLoading, refetch } = api.search.searchAll.useQuery(
    {
      query: searchQuery,
      location,
      filters: {
        type: searchType,
        dateFrom: dateRange[0] ?? undefined,
        dateTo: dateRange[1] ?? undefined,
      },
    },
    { enabled: searchQuery.length > 0 }
  );

  const handleSearch = () => {
    if (searchQuery) {
      refetch();
    }
  };

  return (
    <Stack gap="md" p="md">
      <h1>Search</h1>

      <TextInput
        placeholder="Search photographers, events..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.currentTarget.value)}
        leftSection={<IconSearch size={16} />}
        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
      />

      <TextInput
        placeholder="Location (optional)"
        value={location}
        onChange={(e) => setLocation(e.currentTarget.value)}
        leftSection={<IconMapPin size={16} />}
      />

      <Select
        label="Search Type"
        value={searchType}
        onChange={(val) => setSearchType(val as any)}
        data={[
          { value: 'all', label: 'All' },
          { value: 'photographers', label: 'Photographers' },
          { value: 'events', label: 'Events' },
        ]}
      />

      {searchType !== 'photographers' && (
        <DatePickerInput
          type="range"
          label="Date Range"
          placeholder="Pick dates"
          value={dateRange}
          onChange={setDateRange}
        />
      )}

      <Button onClick={handleSearch} loading={isLoading}>
        Search
      </Button>

      {results && <SearchResults results={results} />}
    </Stack>
  );
}
```

**Action Items**:
- [ ] Create search page UI
- [ ] Add search filters
- [ ] Connect to tRPC query

#### Step 3: Build Search Results Component (2 hours)
**File**: `src/app/app/search/_components/SearchResults.tsx` (NEW)

```typescript
import { Tabs } from '@mantine/core';
import { EventCard } from '~/app/_components/events/EventCard';
import { PhotographerCard } from './ PhotographerCard';

export function SearchResults({ results }) {
  const hasPhotographers = results.photographers.length > 0;
  const hasEvents = results.events.length > 0;

  if (!hasPhotographers && !hasEvents) {
    return <div>No results found</div>;
  }

  return (
    <Tabs defaultValue="all">
      <Tabs.List>
        <Tabs.Tab value="all">All ({results.photographers.length + results.events.length})</Tabs.Tab>
        {hasPhotographers && (
          <Tabs.Tab value="photographers">Photographers ({results.photographers.length})</Tabs.Tab>
        )}
        {hasEvents && (
          <Tabs.Tab value="events">Events ({results.events.length})</Tabs.Tab>
        )}
      </Tabs.List>

      <Tabs.Panel value="all">
        {results.photographers.map((p) => (
          <PhotographerCard key={p.id} photographer={p} />
        ))}
        {results.events.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </Tabs.Panel>

      <Tabs.Panel value="photographers">
        {results.photographers.map((p) => (
          <PhotographerCard key={p.id} photographer={p} />
        ))}
      </Tabs.Panel>

      <Tabs.Panel value="events">
        {results.events.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </Tabs.Panel>
    </Tabs>
  );
}
```

**Action Items**:
- [ ] Create SearchResults component
- [ ] Reuse existing EventCard component
- [ ] Create or reuse PhotographerCard component

#### Step 4: Add Location Autocomplete (2 hours)

Integrate existing Google Maps autocomplete:

**File**: `src/app/app/search/_components/LocationAutocomplete.tsx` (NEW - adapted from register)

```typescript
import { useState } from 'react';
import { TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { api } from '~/trpc/react';

export function LocationAutocomplete({ value, onChange }) {
  const [input, setInput] = useState(value);
  const [debounced] = useDebouncedValue(input, 300);

  const { data: suggestions } = api.google.autocomplete.useQuery(
    { input: debounced },
    { enabled: debounced.length > 2 }
  );

  return (
    <TextInput
      value={input}
      onChange={(e) => {
        setInput(e.currentTarget.value);
        onChange(e.currentTarget.value);
      }}
      placeholder="Enter location..."
      // Add autocomplete dropdown for suggestions
    />
  );
}
```

**Action Items**:
- [ ] Adapt location autocomplete from registration
- [ ] Add dropdown for suggestions
- [ ] Integrate with search form

---

# 2. MEDIUM PRIORITY FEATURES

## 2.1 Reviews System Implementation

**Status**: Database model exists only
**Priority**: Medium
**Estimated Effort**: 6-8 hours
**Files to Create**: 5-7 files

### Implementation Steps

#### Step 1: Create Reviews tRPC Router (2 hours)
**File**: `src/server/api/routers/review.ts` (NEW)

```typescript
import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";

export const reviewRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({
      photographerId: z.string(),
      rating: z.number().min(1).max(5),
      title: z.string().min(1).max(100),
      description: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check if user already reviewed this photographer
      const existing = await ctx.db.review.findFirst({
        where: {
          photographerId: input.photographerId,
          userId: ctx.session.user.id,
        },
      });

      if (existing) {
        throw new Error("You have already reviewed this photographer");
      }

      return ctx.db.review.create({
        data: {
          ...input,
          userId: ctx.session.user.id,
        },
      });
    }),

  update: protectedProcedure
    .input(z.object({
      reviewId: z.string(),
      rating: z.number().min(1).max(5).optional(),
      title: z.string().min(1).max(100).optional(),
      description: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { reviewId, ...data } = input;

      // Verify ownership
      const review = await ctx.db.review.findUnique({
        where: { id: reviewId },
      });

      if (!review || review.userId !== ctx.session.user.id) {
        throw new Error("Not authorized");
      }

      return ctx.db.review.update({
        where: { id: reviewId },
        data,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ reviewId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const review = await ctx.db.review.findUnique({
        where: { id: input.reviewId },
      });

      if (!review || review.userId !== ctx.session.user.id) {
        throw new Error("Not authorized");
      }

      return ctx.db.review.delete({
        where: { id: input.reviewId },
      });
    }),

  getByPhotographer: publicProcedure
    .input(z.object({
      photographerId: z.string(),
      limit: z.number().default(10),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      return ctx.db.review.findMany({
        where: { photographerId: input.photographerId },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profilePic: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        skip: input.offset,
      });
    }),

  getAverageRating: publicProcedure
    .input(z.object({ photographerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const reviews = await ctx.db.review.findMany({
        where: { photographerId: input.photographerId },
        select: { rating: true },
      });

      if (reviews.length === 0) {
        return { average: 0, count: 0 };
      }

      const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
      return {
        average: sum / reviews.length,
        count: reviews.length,
      };
    }),

  getUserReview: protectedProcedure
    .input(z.object({ photographerId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.review.findFirst({
        where: {
          photographerId: input.photographerId,
          userId: ctx.session.user.id,
        },
      });
    }),
});
```

**Action Items**:
- [ ] Create review router
- [ ] Add to root router
- [ ] Test CRUD operations

#### Step 2: Create Review Components (3 hours)

**File**: `src/app/_components/reviews/ReviewForm.tsx` (NEW)

```typescript
'use client';

import { useState } from 'react';
import { Button, Textarea, TextInput, Rating } from '@mantine/core';
import { useForm } from '@mantine/form';
import { zodResolver } from 'mantine-form-zod-resolver';
import { z } from 'zod';
import { api } from '~/trpc/react';

const schema = z.object({
  rating: z.number().min(1).max(5),
  title: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
});

export function ReviewForm({ photographerId, onSuccess }) {
  const form = useForm({
    initialValues: {
      rating: 5,
      title: '',
      description: '',
    },
    validate: zodResolver(schema),
  });

  const createReview = api.review.create.useMutation({
    onSuccess: () => {
      onSuccess();
      form.reset();
    },
  });

  const handleSubmit = form.onSubmit((values) => {
    createReview.mutate({
      photographerId,
      ...values,
    });
  });

  return (
    <form onSubmit={handleSubmit}>
      <Rating {...form.getInputProps('rating')} />
      <TextInput
        label="Title"
        placeholder="Summary of your experience"
        {...form.getInputProps('title')}
      />
      <Textarea
        label="Description (optional)"
        placeholder="Tell us more about your experience..."
        {...form.getInputProps('description')}
        minRows={4}
      />
      <Button type="submit" loading={createReview.isPending}>
        Submit Review
      </Button>
    </form>
  );
}
```

**File**: `src/app/_components/reviews/ReviewList.tsx` (NEW)

```typescript
import { Rating, Text, Stack, Avatar, Group } from '@mantine/core';
import { api } from '~/trpc/react';

export function ReviewList({ photographerId }) {
  const { data: reviews, isLoading } = api.review.getByPhotographer.useQuery({
    photographerId,
  });

  const { data: avgRating } = api.review.getAverageRating.useQuery({
    photographerId,
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <Stack gap="md">
      {avgRating && (
        <div>
          <Rating value={avgRating.average} readOnly fractions={2} />
          <Text size="sm">{avgRating.average.toFixed(1)} ({avgRating.count} reviews)</Text>
        </div>
      )}

      {reviews?.map((review) => (
        <div key={review.id}>
          <Group>
            <Avatar src={review.user.profilePic} />
            <div>
              <Text fw={700}>{review.user.firstName} {review.user.lastName}</Text>
              <Rating value={review.rating} readOnly />
            </div>
          </Group>
          <Text fw={600}>{review.title}</Text>
          <Text size="sm">{review.description}</Text>
        </div>
      ))}
    </Stack>
  );
}
```

**Action Items**:
- [ ] Create ReviewForm component
- [ ] Create ReviewList component
- [ ] Add styling

#### Step 3: Integrate Reviews into Photographer Profile (2 hours)

**File**: `src/app/_components/profiles/ProfilePage.tsx`

Add reviews tab:

```typescript
<Tabs defaultValue="about">
  <Tabs.List>
    <Tabs.Tab value="about">About</Tabs.Tab>
    <Tabs.Tab value="portfolio">Portfolio</Tabs.Tab>
    <Tabs.Tab value="reviews">Reviews</Tabs.Tab>
  </Tabs.List>

  <Tabs.Panel value="reviews">
    <ReviewList photographerId={photographer.id} />
    {canReview && <ReviewForm photographerId={photographer.id} />}
  </Tabs.Panel>
</Tabs>
```

**Action Items**:
- [ ] Add reviews tab to profile
- [ ] Add review form for logged-in users (who haven't reviewed)
- [ ] Display average rating in profile header

#### Step 4: Add Review Moderation (Optional - 1 hour)

Add soft-delete or flagging system for inappropriate reviews.

---

## 2.2 Portfolio Image Management

**Status**: Database model exists only
**Priority**: Medium
**Estimated Effort**: 6-8 hours
**Files to Create**: 4-6 files

### Implementation Steps

#### Step 1: Add Portfolio Endpoints to Photographer Router (1 hour)

**File**: `src/server/api/routers/photographer.ts`

Add these procedures:

```typescript
addPortfolioImage: protectedProcedure
  .input(z.object({
    photographerId: z.string(),
    image: z.string().url(),
    title: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    tags: z.array(z.string()).default([]),
    isFeatured: z.boolean().default(false),
  }))
  .mutation(async ({ ctx, input }) => {
    // Verify photographer ownership
    const photographer = await ctx.db.photographer.findUnique({
      where: { id: input.photographerId },
    });

    if (!photographer || photographer.userId !== ctx.session.user.id) {
      throw new Error("Not authorized");
    }

    return ctx.db.portfolioImage.create({
      data: input,
    });
  }),

updatePortfolioImage: protectedProcedure
  .input(z.object({
    imageId: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    isFeatured: z.boolean().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    const { imageId, ...data } = input;

    // Verify ownership through photographer
    const image = await ctx.db.portfolioImage.findUnique({
      where: { id: imageId },
      include: { photographer: true },
    });

    if (!image || image.photographer.userId !== ctx.session.user.id) {
      throw new Error("Not authorized");
    }

    return ctx.db.portfolioImage.update({
      where: { id: imageId },
      data,
    });
  }),

deletePortfolioImage: protectedProcedure
  .input(z.object({ imageId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    const image = await ctx.db.portfolioImage.findUnique({
      where: { id: input.imageId },
      include: { photographer: true },
    });

    if (!image || image.photographer.userId !== ctx.session.user.id) {
      throw new Error("Not authorized");
    }

    // Soft delete
    return ctx.db.portfolioImage.update({
      where: { id: input.imageId },
      data: { isDeleted: true },
    });
  }),

getPortfolioImages: publicProcedure
  .input(z.object({ photographerId: z.string() }))
  .query(async ({ ctx, input }) => {
    return ctx.db.portfolioImage.findMany({
      where: {
        photographerId: input.photographerId,
        isDeleted: false,
      },
      orderBy: [
        { isFeatured: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }),
```

**Action Items**:
- [ ] Add portfolio CRUD procedures
- [ ] Test endpoints

#### Step 2: Create Portfolio Upload Component (2 hours)

**File**: `src/app/_components/portfolio/PortfolioUpload.tsx` (NEW)

```typescript
'use client';

import { useState } from 'react';
import { Button, TextInput, Textarea, TagsInput, Checkbox } from '@mantine/core';
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone';
import { useForm } from '@mantine/form';
import { api } from '~/trpc/react';
import { uploadImage } from '~/_lib/cloudinary';

export function PortfolioUpload({ photographerId, onSuccess }) {
  const [uploading, setUploading] = useState(false);

  const form = useForm({
    initialValues: {
      title: '',
      description: '',
      tags: [],
      isFeatured: false,
    },
  });

  const addImage = api.photographer.addPortfolioImage.useMutation({
    onSuccess: () => {
      onSuccess();
      form.reset();
    },
  });

  const handleDrop = async (files: File[]) => {
    if (files.length === 0) return;

    setUploading(true);
    try {
      const imageUrl = await uploadImage(files[0]);

      addImage.mutate({
        photographerId,
        image: imageUrl,
        ...form.values,
      });
    } catch (error) {
      alert('Failed to upload image');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <Dropzone
        onDrop={handleDrop}
        accept={IMAGE_MIME_TYPE}
        maxFiles={1}
        loading={uploading}
      >
        Drop image here or click to select
      </Dropzone>

      <TextInput
        label="Title"
        placeholder="Image title"
        {...form.getInputProps('title')}
      />

      <Textarea
        label="Description"
        placeholder="Describe this image..."
        {...form.getInputProps('description')}
      />

      <TagsInput
        label="Tags"
        placeholder="Add tags..."
        {...form.getInputProps('tags')}
      />

      <Checkbox
        label="Feature this image"
        {...form.getInputProps('isFeatured', { type: 'checkbox' })}
      />
    </div>
  );
}
```

**Action Items**:
- [ ] Create upload component
- [ ] Integrate Cloudinary upload
- [ ] Add form validation

#### Step 3: Create Portfolio Gallery Component (2 hours)

**File**: `src/app/_components/portfolio/PortfolioGallery.tsx` (NEW)

```typescript
'use client';

import { useState } from 'react';
import { SimpleGrid, Image, Modal, ActionIcon, Text } from '@mantine/core';
import { IconStar, IconEdit, IconTrash } from '@tabler/icons-react';
import { api } from '~/trpc/react';

export function PortfolioGallery({ photographerId, editable = false }) {
  const [selectedImage, setSelectedImage] = useState(null);

  const { data: images, refetch } = api.photographer.getPortfolioImages.useQuery({
    photographerId,
  });

  const deleteImage = api.photographer.deletePortfolioImage.useMutation({
    onSuccess: () => refetch(),
  });

  const handleDelete = (imageId: string) => {
    if (confirm('Delete this image?')) {
      deleteImage.mutate({ imageId });
    }
  };

  return (
    <>
      <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="md">
        {images?.map((img) => (
          <div key={img.id} style={{ position: 'relative' }}>
            <Image
              src={img.image}
              alt={img.title}
              onClick={() => setSelectedImage(img)}
              style={{ cursor: 'pointer' }}
            />
            {img.isFeatured && (
              <IconStar
                style={{ position: 'absolute', top: 8, right: 8 }}
                color="gold"
              />
            )}
            {editable && (
              <div style={{ position: 'absolute', bottom: 8, right: 8 }}>
                <ActionIcon onClick={() => handleDelete(img.id)}>
                  <IconTrash size={16} />
                </ActionIcon>
              </div>
            )}
          </div>
        ))}
      </SimpleGrid>

      <Modal
        opened={!!selectedImage}
        onClose={() => setSelectedImage(null)}
        size="xl"
      >
        {selectedImage && (
          <>
            <Image src={selectedImage.image} alt={selectedImage.title} />
            <Text fw={700}>{selectedImage.title}</Text>
            <Text size="sm">{selectedImage.description}</Text>
          </>
        )}
      </Modal>
    </>
  );
}
```

**Action Items**:
- [ ] Create gallery component
- [ ] Add lightbox modal
- [ ] Add edit/delete controls for owner

#### Step 4: Integrate Portfolio into Profile (1 hour)

**File**: `src/app/_components/profiles/ProfilePage.tsx`

Add portfolio tab:

```typescript
<Tabs.Panel value="portfolio">
  {isOwner && (
    <PortfolioUpload
      photographerId={photographer.id}
      onSuccess={() => refetch()}
    />
  )}
  <PortfolioGallery
    photographerId={photographer.id}
    editable={isOwner}
  />
</Tabs.Panel>
```

**Action Items**:
- [ ] Add portfolio tab
- [ ] Show upload form to owner
- [ ] Display gallery

---

# 3. BUG FIXES

## 3.1 Remove Console Statements (ESLint Violations)

**Priority**: High
**Estimated Effort**: 1-2 hours
**Files to Fix**: 7 files

### Implementation Steps

Replace all `console.log/error/warn` with proper logger:

#### Files to Fix:

1. **src/server/auth.ts:105**
```typescript
// Before
console.log("sendVerificationRequest", { email, provider, url });

// After
logger.info("sendVerificationRequest", { email, provider, url });
```

2. **src/app/register/_components/LocationAutocomplete.tsx:33**
```typescript
// Before
console.log("Error fetching data");

// After
logger.error("Error fetching location autocomplete data");
```

3. **src/app/_components/profiles/ProfileAvatar.tsx:53**
```typescript
// Before
console.error('Error uploading image:', error);

// After
logger.error('Error uploading profile avatar', { error });
```

4. **src/app/_components/events/CreateEventForm.tsx:66**
```typescript
// Before
console.error('Error uploading image:', error);

// After
logger.error('Error uploading event image', { error });
// Also add user-facing error notification
```

5. **src/app/app/events/[id]/page.tsx:28,33**
```typescript
// Before
refetchComments().catch(console.error);
refetchCommentCount().catch(console.error);

// After
refetchComments().catch((err) => logger.error('Failed to refetch comments', { error: err }));
refetchCommentCount().catch((err) => logger.error('Failed to refetch comment count', { error: err }));
```

6. **src/app/app/messages/_components/NewMessageModal.tsx:54,66**
```typescript
// Before
console.error("Error fetching recipients");
console.error("Error finding message", messageThreadError);

// After
logger.error("Error fetching recipients", { error });
logger.error("Error finding message", { error: messageThreadError });
```

### Action Items:
- [ ] Replace all console statements with logger
- [ ] Run ESLint to verify: `npm run lint`
- [ ] Ensure no new violations

---

## 3.2 Fix Duplicate Favorites Router

**Priority**: Medium
**Estimated Effort**: 1 hour
**Files to Modify**: 3 files

### Implementation Steps

#### Step 1: Consolidate into Single Router

**Decision**: Keep `favoriteRouter` (more generic), remove from `userRouter`

**File**: `src/server/api/routers/favorite.ts`

Update to be more user-friendly:

```typescript
export const favoriteRouter = createTRPCRouter({
  add: protectedProcedure
    .input(z.object({
      photographerId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.favorite.create({
        data: {
          targetId: input.photographerId,
          userId: ctx.session.user.id,
        },
      });
    }),

  remove: protectedProcedure
    .input(z.object({
      photographerId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.favorite.deleteMany({
        where: {
          targetId: input.photographerId,
          userId: ctx.session.user.id,
        },
      });
    }),

  getMyFavorites: protectedProcedure
    .query(({ ctx }) => {
      return ctx.db.favorite.findMany({
        where: { userId: ctx.session.user.id },
        include: {
          // Include photographer details
        },
      });
    }),

  isFavorited: protectedProcedure
    .input(z.object({ photographerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const fav = await ctx.db.favorite.findFirst({
        where: {
          targetId: input.photographerId,
          userId: ctx.session.user.id,
        },
      });
      return !!fav;
    }),
});
```

#### Step 2: Remove from User Router

**File**: `src/server/api/routers/user.ts`

Remove `addFavorite`, `getFavorites`, `removeFavorite` procedures.

#### Step 3: Update Frontend Components

**File**: `src/app/_components/profiles/FavoriteButton.tsx`

Update API calls:

```typescript
// Before
const addFav = api.user.addFavorite.useMutation();
const removeFav = api.user.removeFavorite.useMutation();

// After
const addFav = api.favorite.add.useMutation();
const removeFav = api.favorite.remove.useMutation();
```

### Action Items:
- [ ] Update favoriteRouter
- [ ] Remove duplicate procedures from userRouter
- [ ] Update FavoriteButton component
- [ ] Test favorite add/remove flow

---

## 3.3 Fix TypeScript 'any' Type in db.ts

**Priority**: Low
**Estimated Effort**: 30 minutes
**Files to Fix**: 1 file

### Implementation Steps

**File**: `src/server/db.ts:28`

```typescript
// Before
async findMany({ model, operation, args, query }: any) {

// After
import type { Prisma } from '@prisma/client';

async findMany({ args, query }: {
  model: string;
  operation: string;
  args: Prisma.MessageFindManyArgs;
  query: (args: Prisma.MessageFindManyArgs) => Promise<any>;
}) {
```

### Action Items:
- [ ] Import proper Prisma types
- [ ] Replace any with typed parameters
- [ ] Verify TypeScript compilation

---

## 3.4 Add Proper Error Handling to Image Uploads

**Priority**: Medium
**Estimated Effort**: 1 hour
**Files to Fix**: 2 files

### Implementation Steps

#### File 1: `src/app/_components/profiles/ProfileAvatar.tsx`

Replace TODO with proper handling:

```typescript
// Around line 51
try {
  const imageUrl = await uploadImage(file);
  updateProfile.mutate({ avatar: imageUrl });
} catch (error) {
  // Remove TODO comment
  logger.error('Error uploading profile avatar', { error });

  // Add user notification
  notifications.show({
    title: 'Upload Failed',
    message: 'Failed to upload image. Please try again.',
    color: 'red',
  });
}
```

#### File 2: `src/app/_components/events/CreateEventForm.tsx`

```typescript
// Around line 64
try {
  const imageUrl = await uploadImage(file);
  form.setFieldValue('image', imageUrl);
} catch (error) {
  // Remove TODO comment
  logger.error('Error uploading event image', { error });

  notifications.show({
    title: 'Upload Failed',
    message: 'Failed to upload image. Please try again.',
    color: 'red',
  });
}
```

**Additional**: Add Mantine notifications:

```typescript
import { notifications } from '@mantine/notifications';
```

### Action Items:
- [ ] Add proper error handling
- [ ] Remove TODO comments
- [ ] Add user-facing error notifications
- [ ] Test upload error scenarios

---

## 3.5 Update .env.example

**Priority**: Low
**Estimated Effort**: 30 minutes
**Files to Fix**: 1 file

### Implementation Steps

**File**: `.env.example`

```env
# Since the ".env" file is gitignored, you can use the ".env.example" file to
# build a new ".env" file when you clone the repo. Keep this file up-to-date
# when you add new variables to `.env`.

# Prisma
# PostgreSQL database URL
DATABASE_URL="postgresql://user:password@localhost:5432/myiso"

# Next Auth
NEXTAUTH_SECRET="" # Generate with: openssl rand -base64 32
NEXTAUTH_URL="http://localhost:3000"

# Next Auth Google Provider
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""

# Google Maps API
GOOGLE_PLACES_API_KEY=""
NEXT_PUBLIC_GOOGLE_PLACES_API_KEY=""

# Stripe
STRIPE_SECRET_KEY=""
STRIPE_WEBHOOK_SECRET=""
NEXT_PUBLIC_STRIPE_PUBLIC_KEY=""
NEXT_PUBLIC_STRIPE_PRICE_ID_PRO=""

# Cloudinary
CLOUDINARY_CLOUD_NAME=""
CLOUDINARY_API_KEY=""
CLOUDINARY_API_SECRET=""

# Email (Postmark)
EMAIL_FROM=""
POSTMARK_API_TOKEN=""
EMAIL_SERVER_HOST="smtp.postmarkapp.com"
EMAIL_SERVER_PORT="587"
EMAIL_SERVER_USER=""
EMAIL_SERVER_PASSWORD=""

# Supabase
NEXT_PUBLIC_SUPABASE_URL=""
NEXT_PUBLIC_SUPABASE_ANON_KEY=""

# Analytics
NEXT_PUBLIC_POSTHOG_PUBLIC_KEY=""
NEXT_PUBLIC_POSTHOG_HOST=""

# Base URL
BASE_URL="http://localhost:3000"
```

### Action Items:
- [ ] Update .env.example with all required variables
- [ ] Remove outdated variables (Discord, SQLite)
- [ ] Add helpful comments
- [ ] Verify against env.js schema

---

# 4. DEPENDENCY ISSUES

## 4.1 Fix Embla Carousel Version Mismatch

**Priority**: High
**Estimated Effort**: 30 minutes
**Files to Modify**: 1 file

### Implementation Steps

**File**: `package.json`

```json
// Before
"embla-carousel-react": "^7.1.0"

// After
"embla-carousel-react": "^8.6.0",
"embla-carousel": "^8.6.0"  // Add missing peer dependency
```

### Migration Notes

Embla Carousel v8 has breaking changes:

1. **Update imports** (if using embla directly):
```typescript
// Before
import { EmblaOptionsType } from 'embla-carousel-react';

// After
import type { EmblaOptionsType } from 'embla-carousel';
```

2. **Check carousel usage** in codebase:
```bash
grep -r "Carousel" src/
```

3. **Test carousel components** after update

### Action Items:
- [ ] Update package.json
- [ ] Run `npm install --legacy-peer-deps`
- [ ] Test all carousel components
- [ ] Verify no breaking changes in app

---

## 4.2 Resolve Prisma Engine Download Issue

**Priority**: Critical (Build Blocker)
**Estimated Effort**: Variable (network-dependent)

### Current Issue
```
Failed to fetch the engine file at https://binaries.prisma.sh/.../schema-engine.gz - 403 Forbidden
```

### Potential Solutions

#### Solution 1: Use Environment Variable Workaround
```bash
export PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
npm install
```

Add to package.json scripts:
```json
"postinstall": "PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 prisma generate"
```

#### Solution 2: Check Network/Firewall
- Verify no corporate firewall blocking binaries.prisma.sh
- Check if VPN is interfering
- Try different network

#### Solution 3: Use Pre-downloaded Engines
```bash
# Download engines manually
npx prisma --version # Triggers download
```

#### Solution 4: Update Prisma (if CDN issue is resolved)
```json
"@prisma/client": "^7.2.1",  // Check for newer patch version
"prisma": "^7.2.1"
```

### Action Items:
- [ ] Try environment variable workaround
- [ ] Check network/firewall settings
- [ ] Monitor Prisma GitHub issues for CDN status
- [ ] Test build after resolution

---

# 5. CODE QUALITY IMPROVEMENTS

## 5.1 Replace Console Logger with Proper Logging Library

**Priority**: Low
**Estimated Effort**: 2-3 hours
**Files to Modify**: 2 files + all logger.* calls

### Current State

**File**: `src/_utils/logger.ts` has TODO:
```typescript
/**
 * TODO: Replace with a proper logger like Winston or Pino.
 */
```

### Implementation Steps

#### Step 1: Choose and Install Logger (30 mins)

**Recommendation**: Use `pino` (better Next.js support, structured logging)

```bash
npm install pino pino-pretty
npm install --save-dev @types/pino
```

#### Step 2: Create New Logger (1 hour)

**File**: `src/_utils/logger.ts`

```typescript
import pino from 'pino';
import { env } from '~/env';

const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  browser: {
    asObject: true,
  },
  ...(env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'SYS:standard',
      },
    },
  }),
});

// Type-safe wrapper
export const appLogger = {
  error: (message: string, metadata?: Record<string, unknown>) => {
    logger.error({ ...metadata }, message);
  },

  info: (message: string, metadata?: Record<string, unknown>) => {
    logger.info({ ...metadata }, message);
  },

  warn: (message: string, metadata?: Record<string, unknown>) => {
    logger.warn({ ...metadata }, message);
  },

  debug: (message: string, metadata?: Record<string, unknown>) => {
    logger.debug({ ...metadata }, message);
  },
};

// For backward compatibility during migration
export { appLogger as logger };
```

#### Step 3: Update All Logger Calls (1 hour)

Search and replace pattern across codebase:

```bash
# Find all logger usage
grep -r "logger\." src/
```

No changes needed if using same interface!

#### Step 4: Add Log Levels to env.js (Optional)

```typescript
// src/env.js
server: {
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
}
```

### Action Items:
- [ ] Install pino
- [ ] Replace logger implementation
- [ ] Test logging in development
- [ ] Test logging in production build
- [ ] Add log rotation (production)

---

## 5.2 Add Input Sanitization for XSS Prevention

**Priority**: Medium
**Estimated Effort**: 2-3 hours
**Files to Modify**: Multiple components

### Current Issue

User-generated content (bios, comments, event descriptions) not sanitized for XSS.

### Implementation Steps

#### Step 1: Install Sanitization Library (15 mins)

```bash
npm install dompurify
npm install --save-dev @types/dompurify
npm install isomorphic-dompurify  # For SSR compatibility
```

#### Step 2: Create Sanitization Utility (30 mins)

**File**: `src/_utils/sanitize.ts` (NEW)

```typescript
import DOMPurify from 'isomorphic-dompurify';

export const sanitizeHtml = (dirty: string): string => {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
    ALLOWED_ATTR: ['href', 'target'],
  });
};

export const sanitizeText = (text: string): string => {
  return DOMPurify.sanitize(text, { ALLOWED_TAGS: [] });
};
```

#### Step 3: Add Sanitization to tRPC Procedures (1 hour)

**Files**:
- `src/server/api/routers/event.ts` - Event creation/update
- `src/server/api/routers/photographer.ts` - Bio updates
- `src/server/api/routers/message.ts` - Message content

Example:

```typescript
import { sanitizeText, sanitizeHtml } from '~/_utils/sanitize';

// In event creation
create: protectedProcedure
  .input(eventSchema)
  .mutation(async ({ ctx, input }) => {
    return ctx.db.event.create({
      data: {
        ...input,
        title: sanitizeText(input.title),
        description: input.description ? sanitizeHtml(input.description) : null,
      },
    });
  }),
```

#### Step 4: Sanitize Display (Client-Side) (1 hour)

For components displaying user content:

```typescript
import { sanitizeHtml } from '~/_utils/sanitize';

// In component
<div dangerouslySetInnerHTML={{ __html: sanitizeHtml(description) }} />
```

**Or better**: Use a safe component:

```typescript
// src/_components/SafeHtml.tsx
export function SafeHtml({ content }: { content: string }) {
  return (
    <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }} />
  );
}
```

### Files to Update:
- Event cards (description)
- Photographer bios
- Comment content
- Message content
- Review content

### Action Items:
- [ ] Install dompurify
- [ ] Create sanitization utilities
- [ ] Add server-side sanitization to all user input
- [ ] Add client-side sanitization to displays
- [ ] Test with XSS payloads

---

## 5.3 Add Rate Limiting to API Routes

**Priority**: Medium
**Estimated Effort**: 2-3 hours
**Files to Create**: 2-3 files

### Implementation Steps

#### Step 1: Install Rate Limiting Library (15 mins)

```bash
npm install @upstash/ratelimit @upstash/redis
# Or for local development
npm install rate-limiter-flexible
```

#### Step 2: Create Rate Limit Middleware (1 hour)

**File**: `src/server/api/middleware/rateLimit.ts` (NEW)

Using `rate-limiter-flexible` (no external service required):

```typescript
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { TRPCError } from '@trpc/server';

// Different limits for different operations
const rateLimiters = {
  auth: new RateLimiterMemory({
    points: 5, // 5 requests
    duration: 60, // per minute
  }),

  mutations: new RateLimiterMemory({
    points: 30,
    duration: 60,
  }),

  queries: new RateLimiterMemory({
    points: 100,
    duration: 60,
  }),
};

export const createRateLimitMiddleware = (type: keyof typeof rateLimiters) => {
  return async ({ ctx, next }: any) => {
    const identifier = ctx.session?.user?.id ?? ctx.ip ?? 'anonymous';

    try {
      await rateLimiters[type].consume(identifier);
      return next();
    } catch (err) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests. Please try again later.',
      });
    }
  };
};
```

#### Step 3: Apply to tRPC Procedures (1 hour)

**File**: `src/server/api/trpc.ts`

```typescript
import { createRateLimitMiddleware } from './middleware/rateLimit';

const rateLimitMutation = createRateLimitMiddleware('mutations');
const rateLimitAuth = createRateLimitMiddleware('auth');

export const rateLimitedProcedure = publicProcedure.use(rateLimitMutation);
export const rateLimitedAuthProcedure = publicProcedure.use(rateLimitAuth);
```

**File**: `src/server/api/routers/auth.ts`

```typescript
import { rateLimitedAuthProcedure } from '../trpc';

export const authRouter = createTRPCRouter({
  register: rateLimitedAuthProcedure
    .input(registerSchema)
    .mutation(async ({ ctx, input }) => {
      // ...
    }),
});
```

#### Step 4: Add Rate Limit Headers (Optional - 30 mins)

**File**: `src/app/api/trpc/[trpc]/route.ts`

Add rate limit info to response headers:

```typescript
res.headers.set('X-RateLimit-Limit', '30');
res.headers.set('X-RateLimit-Remaining', remaining.toString());
```

### Action Items:
- [ ] Install rate-limiter-flexible
- [ ] Create rate limit middleware
- [ ] Apply to auth endpoints
- [ ] Apply to mutation endpoints
- [ ] Test rate limiting
- [ ] Add proper error messages

---

# 6. SECURITY ENHANCEMENTS

## 6.1 Add Stripe Webhook Signature Verification

**Priority**: Critical
**Estimated Effort**: Already included in webhook implementation above

**Note**: This is already covered in section 1.1 Step 2 (webhook handler).

Verification code:
```typescript
const signature = req.headers.get("stripe-signature");
event = stripe.webhooks.constructEvent(
  body,
  signature,
  env.STRIPE_WEBHOOK_SECRET
);
```

### Action Items:
- [ ] Ensure webhook secret is configured
- [ ] Test signature verification
- [ ] Test webhook with invalid signature

---

## 6.2 Add CSRF Protection (Already Covered)

NextAuth.js provides CSRF protection by default. No action needed.

---

## 6.3 Add SQL Injection Prevention (Already Covered)

Prisma ORM prevents SQL injection by using parameterized queries. No action needed.

---

## 6.4 Add Authentication Token Validation

**Priority**: Medium
**Estimated Effort**: 1 hour

### Review Session Security

**File**: `src/server/auth.ts`

Current settings:
```typescript
session: {
  strategy: "jwt",
  maxAge: 30 * 24 * 60 * 60, // 30 days
}
```

Consider:
- Reducing maxAge to 7 days for better security
- Adding session rotation
- Adding device tracking

### Action Items:
- [ ] Review session duration
- [ ] Consider adding session rotation
- [ ] Add suspicious activity detection

---

# IMPLEMENTATION PRIORITY ORDER

## Phase 1: Critical Business Features (Week 1-2)
1. **Stripe Payment Integration** (1.1) - 8-12 hours
   - Core business functionality
   - Required for monetization

2. **Search Feature** (1.2) - 6-8 hours
   - Key user experience feature
   - Placeholder exists, users may expect it

## Phase 2: Code Quality & Stability (Week 2-3)
3. **Fix Dependency Issues** (4.1, 4.2) - 2-3 hours
   - Build blockers
   - Peer dependency warnings

4. **Fix ESLint Violations** (3.1) - 1-2 hours
   - Code quality
   - Quick wins

5. **Fix Duplicate Router** (3.2) - 1 hour
   - Code cleanup
   - Reduce confusion

## Phase 3: Feature Completion (Week 3-4)
6. **Reviews System** (2.1) - 6-8 hours
   - User trust feature
   - Database already exists

7. **Portfolio Management** (2.2) - 6-8 hours
   - Photographer showcase
   - Database already exists

## Phase 4: Polish & Security (Week 4-5)
8. **Error Handling** (3.4) - 1 hour
   - User experience
   - Remove TODOs

9. **Input Sanitization** (5.2) - 2-3 hours
   - Security
   - XSS prevention

10. **Rate Limiting** (5.3) - 2-3 hours
    - Security
    - API protection

## Phase 5: Infrastructure (Ongoing)
11. **Logging Improvements** (5.1) - 2-3 hours
    - Monitoring
    - Debugging

12. **.env.example Update** (3.5) - 30 mins
    - Documentation
    - Developer experience

---

# TOTAL ESTIMATED EFFORT

- **Critical Features**: 14-20 hours
- **Bug Fixes**: 4-6 hours
- **Code Quality**: 6-9 hours
- **Security**: 3-4 hours

**Total**: 27-39 hours (approximately 1-2 weeks for single developer)

---

# SUCCESS METRICS

After implementation:

- [ ] Build completes without errors
- [ ] All ESLint rules pass
- [ ] No console statements in code
- [ ] Payment flow works end-to-end
- [ ] Search returns relevant results
- [ ] Reviews can be created and displayed
- [ ] Portfolio images can be uploaded
- [ ] Rate limiting prevents abuse
- [ ] XSS attempts are sanitized
- [ ] All TypeScript types are explicit
- [ ] .env.example is up to date

---

*Last Updated: 2025-12-27*
*Created by: Claude Code Audit*
