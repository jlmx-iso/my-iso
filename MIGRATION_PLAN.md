# Legacy Modernization Migration Plan

## Executive Summary

This document outlines the phased approach to modernize the my-iso codebase from legacy dependency versions to current stable releases. The migration will be executed across 6 phases with clear testing checkpoints between each phase.

**Total Estimated Effort**: 12-18 hours of focused development work
**Risk Level**: Medium (multiple major version updates with breaking changes)
**Rollback Strategy**: Git branches for each phase with comprehensive testing before merging

---

## Dependency Version Matrix

| Package | Current | Target | Breaking Changes |
|---------|---------|--------|------------------|
| @mantine/core | 7.12.1 | 8.3.10 | Major - Component API changes, dates format |
| @tanstack/react-query | 4.36.1 | 5.90.12 | Major - Callback deprecation, status renaming |
| @trpc/* | 10.45.2 | 11.8.1 | Major - Async APIs, Node 18+ required |
| @prisma/client | 5.15.0 | 7.2.0 | Major - Adapter architecture, CLI changes |
| next | 14.2.3 | 15.x | Major - Async request APIs, React 19 |
| react | 18.2.0 | 19.x | Major - Hook renames, new features |
| stripe | 2.4.0 | 14.25.0 | Minor usage - SDK updates only |
| @sentry/nextjs | 8.x | 10.32.1 | Minor - Config updates |

---

## Phase 1: Foundation & Low-Risk Updates (2-3 hours)

### Objective
Update dependencies with minimal breaking changes to establish baseline stability.

### Updates
1. **Minor/Patch Updates**
   - @sentry/nextjs: 8.x → 10.32.1
   - @vercel/analytics: update to latest
   - @vercel/speed-insights: update to latest
   - dayjs: update to latest
   - zod: update to latest
   - superjson: update to latest

2. **Stripe SDK** (2.4.0 → 14.25.0)
   - **Impact**: Minimal (only 1 file: `src/app/webhooks/stripe/WIProute.ts`)
   - **Changes Required**:
     - Update SDK initialization syntax (already using standard pattern)
     - Verify webhook signature validation still works
     - Test customer creation/update flow

### Testing Checklist
- [ ] Build completes without errors
- [ ] Sentry error reporting works in dev
- [ ] Stripe webhook handler processes test events
- [ ] No runtime errors in browser console

### Rollback Plan
Revert `package.json` changes and run `npm install`

---

## Phase 2: React Query v5 Migration (2-3 hours)

### Objective
Migrate from React Query v4 to v5, removing deprecated callback patterns.

### Breaking Changes
1. **Status Renaming**
   - `isLoading` → `isPending` (for queries)
   - New `isLoading` = `isPending && isFetching`

2. **Callback Deprecation**
   - `onSuccess`, `onError`, `onSettled` removed from mutations
   - Must use `.then()/.catch()` or separate effect hooks

### Files Requiring Changes (10 files)
```
src/app/_components/AddCommentForm.tsx
src/app/_components/CreatePost.tsx
src/app/_components/events/EventCard.tsx
src/app/_components/events/EventComment.tsx
src/app/api/trpc/[trpc]/route.ts
src/app/app/events/[id]/page.tsx
src/app/verify/[token]/page.tsx
src/server/_db/user.ts
src/server/api/routers/auth.ts
```

### Migration Pattern

**Before:**
```tsx
const { mutate, isLoading } = api.event.addCommentToEvent.useMutation();

mutate({
  content: values.comment,
  eventId,
}, {
  onSuccess: () => {
    commentRefetcher.refetchComments()
  }
});
```

**After:**
```tsx
const { mutate, isPending } = api.event.addCommentToEvent.useMutation({
  onSuccess: () => {
    commentRefetcher.refetchComments()
  }
});

mutate({
  content: values.comment,
  eventId,
});
```

### Automated Migration
Run TanStack's codemod:
```bash
npx @tanstack/query-codemod v5/replace-use-query-options
npx @tanstack/query-codemod v5/rename-properties
```

Then manually review and fix:
1. Move callbacks from mutation call to `useMutation()` options
2. Update `isLoading` to `isPending` for loading states
3. Verify `onSuccess` in `useQuery` (line 30 in EventCard.tsx) - move to effect hook

### Testing Checklist
- [ ] All forms submit successfully
- [ ] Loading states display correctly
- [ ] Success/error notifications appear
- [ ] Comment refetching works after submission
- [ ] Event creation flow completes

---

## Phase 3: Mantine v8 Migration (3-4 hours)

### Objective
Upgrade Mantine UI library with focus on @mantine/dates breaking changes.

### Breaking Changes

#### 1. @mantine/dates - Date Format Change
**Impact**: MAJOR - All date components now use string format `YYYY-MM-DD HH:mm:ss`

**Files Affected:**
- `src/app/_components/events/CreateEventForm.tsx`
- Any component using `DateTimePicker`, `DatePicker`

**Migration Pattern:**

**Before:**
```tsx
const form = useForm({
  initialValues: {
    date: new Date(),
  },
  validate: zodResolver(z.object({
    date: z.date().min(new Date())
  }))
});

// Later: values.date.toISOString()
```

**After:**
```tsx
import dayjs from 'dayjs';

const form = useForm({
  initialValues: {
    date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
  },
  validate: zodResolver(z.object({
    date: z.string().refine((val) => dayjs(val).isAfter(dayjs()))
  }))
});

// Later: use date string directly or parse with dayjs(values.date).toISOString()
```

#### 2. @mantine/carousel Changes
- Remove `speed` and `draggable` props if used
- Ensure `embla-carousel` and `embla-carousel-react` are installed (already in package.json)
- Wrap carousel-specific props in `emblaOptions` prop

#### 3. CSS Imports
- No changes needed (using main `styles.css`)

#### 4. Component API Changes
- Review official migration guide for any used components
- Test all Mantine components visually

### Migration Steps
1. Update package.json to Mantine 8.x
2. Run build to identify breaking changes
3. Update date handling in CreateEventForm
4. Update form validation schemas for dates
5. Check carousel usage (if any)
6. Visual regression testing

### Testing Checklist
- [ ] DateTimePicker displays correctly
- [ ] Date validation works (future dates only)
- [ ] Form submissions with dates work
- [ ] Event creation with date/time succeeds
- [ ] All UI components render correctly
- [ ] No console warnings about deprecated props

---

## Phase 4: tRPC v11 Migration (2-3 hours)

### Objective
Upgrade tRPC to v11 with minimal breaking changes (mostly backwards compatible).

### Breaking Changes

1. **Node.js Requirement**
   - Must use Node.js 18+
   - Verify deployment environment supports this

2. **Renamed Functions**
   - `createTRPCProxyClient` → `createTRPCClient` (aliased, not breaking yet)
   - `createProxySSGHelpers` → `createSSGHelpers` (aliased, not breaking yet)

3. **Removed Features**
   - `interop-mode` removed (not used in this codebase)

### Files to Review
- All files in `src/server/api/`
- `src/app/api/trpc/[trpc]/route.ts`
- `src/trpc/` (client setup)

### Migration Steps
1. Update all @trpc packages to 11.8.1
2. Run build to check for errors
3. Review and test all tRPC procedures
4. Verify SSR data fetching still works
5. Test real-time features if any

### Testing Checklist
- [ ] All API routes respond correctly
- [ ] Protected procedures require auth
- [ ] Type inference works in client components
- [ ] SSR/SSG pages load correctly
- [ ] No TypeScript errors

---

## Phase 5: Prisma v7 Migration (3-4 hours)

### Objective
Migrate to Prisma v7 with adapter-based architecture for PostgreSQL.

### Breaking Changes

#### 1. Adapter Architecture (MAJOR)
Must explicitly install and configure database adapter.

**New Dependencies Required:**
```json
{
  "@prisma/adapter-pg": "^7.2.0",
  "pg": "^8.11.3"
}
```

**Current Code:**
```ts
// src/server/db.ts
export const db = new PrismaClient({
  log: env.NODE_ENV === "development" ? ["query", "info", "error", "warn"] : ["error"],
}).$extends({...});
```

**After Migration:**
```ts
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const pool = new Pool({ connectionString: env.DATABASE_URL })
const adapter = new PrismaPg(pool)

export const db = new PrismaClient({
  adapter,
  log: env.NODE_ENV === "development" ? ["query", "info", "error", "warn"] : ["error"],
}).$extends({...});
```

#### 2. CLI Changes
- `prisma migrate dev` no longer runs `prisma generate` automatically
- `--skip-generate` flag removed
- Automatic seeding removed

**Update package.json scripts:**
```json
{
  "db:push": "prisma generate && prisma db push",
  "postinstall": "prisma generate"
}
```

#### 3. Mapped Enums
Review any `@map()` directives on enums - TypeScript enum values now use mapped values instead of schema names.

### Migration Steps
1. Install pg and @prisma/adapter-pg
2. Update src/server/db.ts with adapter setup
3. Update package.json scripts
4. Run `prisma generate`
5. Test database connection
6. Run existing app to verify queries work
7. Check Prisma client extensions still work

### Testing Checklist
- [ ] Database connection succeeds
- [ ] All queries execute successfully
- [ ] Prisma client extensions work ($extends with message query)
- [ ] Migrations can be created and applied
- [ ] `db:push` command works
- [ ] Prisma Studio connects and works

### Rollback Plan
Downgrade Prisma packages, remove adapter setup, restore old db.ts

---

## Phase 6: Next.js 15 + React 19 (3-4 hours)

### Objective
Upgrade to Next.js 15 with React 19 support.

### Breaking Changes

#### 1. Async Request APIs
Dynamic APIs are now asynchronous:

**Before:**
```ts
const cookieStore = cookies()
const headersList = headers()
```

**After:**
```ts
const cookieStore = await cookies()
const headersList = await headers()
```

**Files to Check:**
- All server components
- Route handlers
- Middleware
- Any usage of `cookies()`, `headers()`, `draftMode()`

#### 2. params and searchParams
Now require `await`:

**Before:**
```tsx
export default function Page({ params, searchParams }: PageProps) {
  const { id } = params;
  // ...
}
```

**After:**
```tsx
export default async function Page({
  params,
  searchParams
}: PageProps) {
  const { id } = await params;
  // ...
}
```

#### 3. Caching Behavior Changes
- `fetch` requests no longer cached by default
- GET Route Handlers no longer cached by default
- Client navigations no longer cached by default

**Action Required**: Explicitly add caching where needed:
```ts
fetch(url, { cache: 'force-cache' }) // To cache
```

#### 4. React 19 Changes
- Update `@types/react` and `@types/react-dom`
- Review for any experimental hooks usage (renamed in v19)

### Automated Migration
Run Next.js codemod:
```bash
npx @next/codemod@canary upgrade latest
```

### Manual Changes Required
1. Review all server components for sync API usage
2. Add `await` to cookies/headers calls
3. Update page components to async if using params/searchParams
4. Review caching strategy for critical fetch calls
5. Test auth flows (next-auth with React 19)

### Testing Checklist
- [ ] All pages render without errors
- [ ] Authentication works (login/logout)
- [ ] Protected routes redirect correctly
- [ ] API routes respond correctly
- [ ] Image optimization works
- [ ] Dynamic routes with params work
- [ ] Search functionality works
- [ ] No hydration errors
- [ ] Build completes successfully
- [ ] Production build runs locally

### Known Issues to Watch
- next-auth compatibility with React 19 (may need updates)
- Third-party libraries that haven't updated for React 19

---

## Pre-Migration Checklist

- [ ] Create feature branch: `feat/dependency-modernization`
- [ ] Ensure all tests pass on current version
- [ ] Create database backup
- [ ] Document current Node.js version
- [ ] Verify Node.js 18+ available in deployment environment
- [ ] Review and close any open PRs to avoid conflicts
- [ ] Notify team of upcoming changes

## Post-Migration Checklist

- [ ] Update README with new Node.js requirement
- [ ] Update CI/CD pipeline if needed (Node version)
- [ ] Run full test suite
- [ ] Perform manual QA of critical paths:
  - [ ] User registration
  - [ ] Login/logout
  - [ ] Create event
  - [ ] Upload images
  - [ ] Comment on events
  - [ ] Message system
  - [ ] Search functionality
  - [ ] Profile editing
- [ ] Monitor Sentry for new errors after deployment
- [ ] Update documentation for any API changes
- [ ] Create git tag for this migration milestone

---

## Risk Mitigation

### High-Risk Areas
1. **@mantine/dates format change** - Date/time handling throughout app
2. **Prisma adapter setup** - Database connection architecture change
3. **Next.js async APIs** - Many files may need updates

### Mitigation Strategies
1. Test each phase thoroughly before proceeding
2. Maintain separate branch for each phase
3. Have rollback plan ready for each phase
4. Test in staging environment before production
5. Deploy during low-traffic period

### Emergency Rollback
Each phase has its own branch:
- `phase-1-foundation`
- `phase-2-react-query`
- `phase-3-mantine`
- `phase-4-trpc`
- `phase-5-prisma`
- `phase-6-nextjs`

If critical issues arise, revert to previous phase branch.

---

## Success Criteria

- [ ] All builds complete without errors
- [ ] All TypeScript types resolve correctly
- [ ] No console errors or warnings in development
- [ ] All critical user flows work end-to-end
- [ ] Performance metrics maintained or improved
- [ ] No new Sentry errors after 48 hours in production
- [ ] Database queries execute successfully
- [ ] Authentication flows work correctly

---

## Future Considerations

**Note**: The user mentioned eventual migration to Cloudflare infrastructure and moving off Supabase. This is NOT part of this migration but should inform architectural decisions:

- Prisma v7 adapter architecture will make database migration easier
- Next.js 15 has better edge runtime support (Cloudflare compatibility)
- Keep database logic modular for future adapter swaps
- Consider Cloudflare D1/Postgres adapters when planning future migration

---

## Documentation References

- [Mantine v7 to v8 Migration](https://mantine.dev/guides/7x-to-8x/)
- [tRPC v10 to v11 Migration](https://trpc.io/docs/migrate-from-v10-to-v11)
- [TanStack Query v4 to v5 Migration](https://tanstack.com/query/latest/docs/framework/react/guides/migrating-to-v5)
- [Prisma v7 Upgrade Guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7)
- [Next.js 15 Upgrade Guide](https://nextjs.org/docs/app/guides/upgrading/version-15)
- [Stripe Node.js SDK Migration](https://github.com/stripe/stripe-node/wiki/Migration-guide-for-v8)

---

*Last Updated: 2025-12-27*
*Prepared by: Claude Code*
