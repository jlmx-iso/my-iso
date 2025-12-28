# Architecture Review: Data Access Layer

## Current Architecture

### Pattern: Direct Prisma Access from tRPC Routers

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  Component  │ ───> │ tRPC Client │ ───> │ tRPC Router │ ───> │  Prisma DB  │
└─────────────┘      └─────────────┘      └─────────────┘      └─────────────┘
```

**All routers** (`photographer.ts`, `event.ts`, `user.ts`, `message.ts`, `search.ts`) follow this pattern:
- Direct `ctx.db.*` calls in router procedures
- No service layer
- No repository pattern
- Type inference from Prisma queries

**Example** (from `photographer.ts:30-36`):
```typescript
getById: protectedProcedure
  .input(z.object({ id: z.string().min(1) }))
  .query(({ ctx, input }) => {
    return ctx.db.photographer.findFirst({  // Direct Prisma call
      where: { id: input.id },
    });
  }),
```

## ✅ What's Working Well

1. **Simple and Direct**: Easy to understand data flow
2. **Type Safety**: Prisma provides excellent TypeScript inference
3. **Fewer Layers**: Less boilerplate, faster development
4. **Consistent Pattern**: All routers follow the same approach
5. **Good for Small-Medium Apps**: This is the T3 Stack recommended pattern

## 🟡 Current Issues

### 1. **Code Duplication**

Multiple routers repeat similar queries:

**photographer.ts:58-70** (basic search):
```typescript
search: publicProcedure
  .query(({ ctx, input }) => {
    return ctx.db.photographer.findMany({
      where: {
        OR: [
          { name: { contains: input.query, mode: "insensitive" } },
          { companyName: { contains: input.query, mode: "insensitive" } },
        ],
      },
    });
  }),
```

**search.ts:22-48** (advanced search with same logic):
```typescript
const photographers = await ctx.db.photographer.findMany({
  where: {
    AND: [
      {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { companyName: { contains: query, mode: 'insensitive' } },
        ],
      },
      // ...
    ],
  },
});
```

### 2. **Business Logic in Routers**

Complex logic mixed with data access (see `event.ts:88-120` - create event):
```typescript
create: protectedProcedure
  .mutation(async ({ ctx, input }) => {
    // Business logic: Get photographer ID
    const photographerId = await ctx.db.photographer.findUnique(...)

    // Business logic: Validate permissions
    if (!photographer || photographer.userId !== ctx.session.user.id) {
      throw new Error("You are not a photographer");
    }

    // Data access: Create event
    return ctx.db.event.create(...)
  }),
```

### 3. **Testing Challenges**

- Can't unit test business logic without mocking entire Prisma client
- Can't test routers without database
- No clear separation between "what" and "how"

### 4. **Type Inference Issues**

When I tried to add explicit types in `search.ts`, it created type mismatches:
```typescript
// This failed:
const results: {
  photographers: PhotographerWithUser[];  // ❌ TypeScript can't verify
  events: EventWithDetails[];
} = { ... };

// Had to remove types and let Prisma infer (current solution)
const photographers = await ctx.db.photographer.findMany(...); // ✅ Inferred
```

## 🔴 When This Pattern Breaks Down

As the app scales, you'll encounter:

1. **Query Complexity**: Complex joins, aggregations, raw SQL
2. **Business Rules**: Permissions, validation, computed fields
3. **Caching**: Can't easily add Redis/cache layer
4. **Multiple Data Sources**: Adding external APIs, microservices
5. **Testing**: Integration tests only, no unit tests
6. **Reusability**: Same query logic repeated across routers

## 📊 Architecture Recommendations

### Option 1: Keep Current Pattern (Recommended for Now)

**When to use**: MVP, small team, < 50k LOC

✅ **Pros**:
- Fast development
- Simple to understand
- Works well with tRPC
- Matches T3 Stack conventions

❌ **Cons**:
- Hard to scale beyond medium complexity
- Testing requires full database
- Business logic scattered

**No changes needed** - current implementation is fine for this stage.

---

### Option 2: Add Service Layer (Recommended for Growth)

**When to use**: Growing team, > 50k LOC, complex business rules

```
┌───────────┐    ┌──────────┐    ┌─────────┐    ┌─────────┐
│ Component │ -> │  tRPC    │ -> │ Service │ -> │ Prisma  │
└───────────┘    └──────────┘    └─────────┘    └─────────┘
```

**Implementation**:

```typescript
// src/server/services/photographer.service.ts
export class PhotographerService {
  constructor(private db: PrismaClient) {}

  async search(query: string, location?: string) {
    return this.db.photographer.findMany({
      where: {
        AND: [
          {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { companyName: { contains: query, mode: 'insensitive' } },
            ],
          },
          ...(location ? [{ location: { contains: location, mode: 'insensitive' } }] : []),
        ],
      },
    });
  }

  async canUserCreateEvent(userId: string): Promise<boolean> {
    const photographer = await this.db.photographer.findUnique({
      where: { userId },
    });
    return !!photographer;
  }
}

// src/server/api/routers/photographer.ts
export const photographerRouter = createTRPCRouter({
  search: publicProcedure
    .input(z.object({ query: z.string(), location: z.string().optional() }))
    .query(({ ctx, input }) => {
      const service = new PhotographerService(ctx.db);
      return service.search(input.query, input.location);
    }),
});
```

✅ **Pros**:
- Business logic centralized
- Easier to test (mock service, not Prisma)
- Reusable across routers
- Clear separation of concerns

❌ **Cons**:
- More boilerplate
- Extra layer to maintain
- Slower initial development

---

### Option 3: Repository Pattern (For Complex Apps)

**When to use**: Large team, > 100k LOC, multiple data sources

```
┌───────────┐  ┌──────┐  ┌─────────┐  ┌────────────┐  ┌──────┐
│ Component │->│ tRPC │->│ Service │->│ Repository │->│  DB  │
└───────────┘  └──────┘  └─────────┘  └────────────┘  └──────┘
```

**Implementation**:

```typescript
// src/server/repositories/photographer.repository.ts
export interface PhotographerRepository {
  findByQuery(query: string, location?: string): Promise<Photographer[]>;
  findById(id: string): Promise<Photographer | null>;
  create(data: CreatePhotographerDto): Promise<Photographer>;
}

export class PrismaPhotographerRepository implements PhotographerRepository {
  constructor(private prisma: PrismaClient) {}

  async findByQuery(query: string, location?: string) {
    return this.prisma.photographer.findMany({
      where: {
        AND: [
          { OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { companyName: { contains: query, mode: 'insensitive' } },
          ]},
          ...(location ? [{ location: { contains: location } }] : []),
        ],
      },
    });
  }
}

// src/server/services/photographer.service.ts
export class PhotographerService {
  constructor(private repo: PhotographerRepository) {}

  async search(query: string, location?: string) {
    const photographers = await this.repo.findByQuery(query, location);
    // Add business logic, transformations, etc.
    return photographers;
  }
}
```

✅ **Pros**:
- Maximum testability
- Can swap data sources (Prisma, MongoDB, API)
- Clear architecture boundaries
- Enterprise-ready

❌ **Cons**:
- Significant boilerplate
- Steep learning curve
- Slower development
- Overkill for most apps

---

## 🎯 Specific Recommendations

### Immediate (Next Sprint)

1. **✅ Fix search.ts type issue** (DONE - removed explicit types)
2. **Extract search logic to shared functions** if code duplication grows
3. **Add integration tests** for search router
4. **Document query patterns** in code comments

### Short Term (Next 3 months)

If you hit these pain points:
- **Same query in 3+ places** → Extract to service layer
- **Complex business logic** → Create service classes
- **Testing becomes hard** → Add service layer
- **Performance issues** → Add caching/query optimization layer

### Long Term (6+ months)

Consider migration to service layer when:
- Team grows beyond 5 developers
- Codebase exceeds 50k LOC
- Need to add external data sources
- Compliance/audit requirements increase

## 📝 Migration Path (If Needed)

### Phase 1: Add Services (No Breaking Changes)
```typescript
// Keep existing router, add service
export const photographerRouter = createTRPCRouter({
  search: publicProcedure
    .query(({ ctx, input }) => {
      // Option A: Direct Prisma (current)
      // return ctx.db.photographer.findMany(...)

      // Option B: Use service (new)
      const service = new PhotographerService(ctx.db);
      return service.search(input.query);
    }),
});
```

### Phase 2: Migrate Gradually
- Start with most duplicated queries (search, user lookup)
- Extract complex business logic (permissions, validation)
- Keep simple CRUD as direct Prisma calls

### Phase 3: Full Service Layer
- All business logic in services
- Routers become thin API adapters
- Services tested independently

## 🧪 Testing Strategy

### Current (Integration Tests Only)
```typescript
// tests/integration/photographer.test.ts
test('can search photographers', async () => {
  const caller = createCaller({ db: prisma, session: null });
  const result = await caller.photographer.search({ query: 'John' });
  expect(result).toHaveLength(1);
});
```

### With Service Layer (Unit + Integration)
```typescript
// tests/unit/photographer.service.test.ts
test('search combines name and company filters', () => {
  const mockDb = createMockPrisma();
  const service = new PhotographerService(mockDb);

  await service.search('John', 'NYC');

  expect(mockDb.photographer.findMany).toHaveBeenCalledWith({
    where: { AND: [/* expected query */] }
  });
});
```

## 🔍 Similar Patterns in Codebase

Checked all routers for consistency:

| Router | Pattern | Direct DB Access | Notes |
|--------|---------|------------------|-------|
| **photographer.ts** | ✅ Direct Prisma | Yes | Simple queries, no complex logic |
| **event.ts** | ✅ Direct Prisma | Yes | Some business logic in create/update |
| **user.ts** | ✅ Direct Prisma | Yes | Minimal logic |
| **message.ts** | ✅ Direct Prisma | Yes | Simple CRUD |
| **search.ts** | ✅ Direct Prisma | Yes | **Fixed**: Removed explicit types |
| **favorite.ts** | ✅ Direct Prisma | Yes | Simple toggle logic |

**Result**: All routers consistently use direct Prisma access. ✅

## 🎓 Key Takeaway

**Your current architecture is CORRECT for this stage of the application.**

The issue in `search.ts` wasn't an architectural problem—it was a TypeScript type annotation mismatch. The fix was to **match the existing pattern** (let Prisma infer types) rather than add explicit types.

**When to refactor**:
- [ ] Same query logic appears in 3+ places
- [ ] Business logic becomes complex (> 50 lines per procedure)
- [ ] Testing requires extensive mocking
- [ ] Team size grows beyond 5 developers
- [ ] Need to integrate external data sources

## 📚 References

- [tRPC Best Practices](https://trpc.io/docs/server/procedures)
- [T3 Stack Patterns](https://create.t3.gg/)
- [Prisma Best Practices](https://www.prisma.io/docs/guides/performance-and-optimization)
- [Clean Architecture (for future reference)](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
