# Search Feature Performance Optimization

## Overview
This document outlines recommended database indexes to improve search query performance as the application scales.

## Current Search Implementation

The search feature performs case-insensitive text searches on:
- **Photographer**: `name`, `bio`, `companyName`, `location`
- **Event**: `title`, `description`, `location`, `date`

## Recommended Database Indexes

### 1. Photographer Search Indexes

```prisma
model Photographer {
  // ... existing fields ...

  @@index([name])
  @@index([location])
  @@index([companyName])
}
```

**Rationale**:
- Indexes on `name`, `location`, and `companyName` will speed up `LIKE`/`ILIKE` queries
- PostgreSQL can use these indexes for pattern matching with certain query types

### 2. Event Search Indexes

```prisma
model Event {
  // ... existing fields ...

  @@index([title])
  @@index([location])
  @@index([date])
  @@index([isDeleted, date]) // Composite index for common query pattern
}
```

**Rationale**:
- `title` and `location` indexes speed up text searches
- `date` index improves date range filtering performance
- Composite `[isDeleted, date]` index optimizes the common pattern of filtering out deleted events while searching by date

### 3. Full-Text Search (Advanced - PostgreSQL Only)

For production deployments with large datasets, consider PostgreSQL full-text search:

```sql
-- Add tsvector columns for full-text search
ALTER TABLE "Photographer" ADD COLUMN search_vector tsvector;
ALTER TABLE "Event" ADD COLUMN search_vector tsvector;

-- Create triggers to maintain tsvector columns
CREATE TRIGGER photographer_search_vector_update
BEFORE INSERT OR UPDATE ON "Photographer"
FOR EACH ROW EXECUTE FUNCTION
tsvector_update_trigger(search_vector, 'pg_catalog.english', name, bio, companyName);

CREATE TRIGGER event_search_vector_update
BEFORE INSERT OR UPDATE ON "Event"
FOR EACH ROW EXECUTE FUNCTION
tsvector_update_trigger(search_vector, 'pg_catalog.english', title, description);

-- Create GIN indexes for fast full-text search
CREATE INDEX photographer_search_idx ON "Photographer" USING GIN(search_vector);
CREATE INDEX event_search_idx ON "Event" USING GIN(search_vector);
```

**Benefits**:
- 10-100x faster text searches on large datasets
- Supports stemming, ranking, and relevance scoring
- Handles multiple languages

**Trade-offs**:
- Requires PostgreSQL-specific features (not portable to other databases)
- Adds complexity to schema and requires trigger maintenance
- Increases storage requirements

## Implementation Steps

### Step 1: Add Basic Indexes (Recommended for All Deployments)

1. Update `prisma/schema.prisma` with the basic indexes shown above
2. Generate migration:
   ```bash
   npx prisma migrate dev --name add_search_indexes
   ```
3. Apply migration:
   ```bash
   npx prisma migrate deploy
   ```

### Step 2: Full-Text Search (Optional - Production Only)

1. Create a migration file manually: `prisma/migrations/[timestamp]_add_fulltext_search/migration.sql`
2. Add the SQL commands from section 3 above
3. Update search queries to use `@@` operator instead of `LIKE`:
   ```typescript
   // Instead of:
   { name: { contains: query, mode: 'insensitive' } }

   // Use raw SQL:
   await prisma.$queryRaw`
     SELECT * FROM "Photographer"
     WHERE search_vector @@ plainto_tsquery('english', ${query})
   `
   ```

## Performance Metrics

### Before Indexes (Estimated)
- 10,000 photographers: ~200-500ms search time
- 50,000 events: ~500-1000ms search time

### After Basic Indexes (Estimated)
- 10,000 photographers: ~50-100ms search time
- 50,000 events: ~100-200ms search time

### With Full-Text Search (Estimated)
- 100,000+ photographers: ~10-30ms search time
- 500,000+ events: ~20-50ms search time

## Monitoring

Monitor search query performance with:
```sql
-- Enable query logging in PostgreSQL
ALTER DATABASE yourdb SET log_min_duration_statement = 100;

-- Analyze slow queries
SELECT * FROM pg_stat_statements
WHERE query LIKE '%Photographer%' OR query LIKE '%Event%'
ORDER BY mean_exec_time DESC;
```

## Additional Optimizations

1. **Query Result Caching**: Consider implementing Redis caching for popular searches
2. **Pagination**: Ensure `limit` and `offset` are always specified (already implemented)
3. **Database Connection Pooling**: Use PgBouncer or similar for high-traffic deployments
4. **Read Replicas**: Route search queries to read replicas in production

## References
- [Prisma Indexing Guide](https://www.prisma.io/docs/concepts/components/prisma-schema/indexes)
- [PostgreSQL Full-Text Search](https://www.postgresql.org/docs/current/textsearch.html)
- [PostgreSQL Index Types](https://www.postgresql.org/docs/current/indexes-types.html)
