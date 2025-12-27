# my-iso

A photographer marketplace and social platform built with the T3 Stack, enabling photographers to showcase portfolios, connect with clients, and manage bookings.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Authentication**: NextAuth.js
- **Database**: PostgreSQL with Prisma ORM
- **API**: tRPC for end-to-end type safety
- **Styling**: Tailwind CSS + Mantine UI
- **Image Management**: Cloudinary
- **Storage**: Supabase
- **Analytics**: PostHog, Vercel Analytics
- **Payments**: Stripe
- **Email**: Postmark

## Project Structure

```
src/
├── app/                    # Next.js App Router pages and layouts
│   ├── _components/        # Shared UI components
│   ├── _lib/              # Client-side utilities
│   ├── _server_utils/     # Server-side utilities
│   ├── api/               # API routes (NextAuth, tRPC)
│   └── app/               # Authenticated app routes
├── server/                # Backend logic
│   ├── api/               # tRPC routers and procedures
│   ├── _db/               # Database utilities
│   ├── _lib/              # Server libraries
│   └── auth.ts            # Authentication configuration
├── _lib/                  # Shared libraries (Cloudinary, Supabase)
├── _types/                # TypeScript type definitions
├── _utils/                # Utility functions
└── styles/                # Global styles
```

## Coding Patterns

### TypeScript

- **Strict mode enabled**: All code must be fully typed
- **No implicit any**: Explicitly type all variables and function parameters
- **Use Zod for validation**: All user inputs and API boundaries use Zod schemas
- **Path aliases**: Use `~/*` for imports from `src/`

### API Design (tRPC)

- Use `publicProcedure` for unauthenticated endpoints
- Use `protectedProcedure` for authenticated endpoints
- All procedures should validate inputs with Zod schemas
- Keep routers focused and organized by domain (auth, user, event, etc.)

Example:
```typescript
export const exampleRouter = createTRPCRouter({
  getData: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.example.findUnique({
        where: { id: input.id },
      });
    }),
});
```

### Error Handling

- Use the custom `Result` type for operations that can fail (see `src/_utils/result.ts`)
- Return `Result.ok(value)` for success
- Return `Result.err(error)` for failures
- Check `result.isOk` before accessing `result.value`

Example:
```typescript
function parseData(raw: string): Result<Data, Error> {
  try {
    const data = JSON.parse(raw);
    return Result.ok(data);
  } catch (error) {
    return Result.err(new Error("Invalid JSON"));
  }
}
```

### Components

- Use the `_components` directory for shared components
- Create index.ts barrel files for clean exports
- Prefix internal/private utilities with underscore (e.g., `_lib/`, `_utils/`)
- Use Mantine components for UI primitives
- Follow the App Router conventions for server/client components

### Database

- All database access through Prisma client (`ctx.db`)
- Use transactions for multi-step operations
- Follow the naming convention: `userId`, `createdAt`, `updatedAt`
- Use `@default(cuid())` for IDs
- Use `@default(now())` for timestamps

### Authentication

- Session data is available in tRPC context as `ctx.session`
- Use `protectedProcedure` to enforce authentication
- User data is guaranteed non-null in protected procedures
- NextAuth configuration is in `src/server/auth.ts`

### File Organization

- Group related code by feature/domain
- Use index.ts for clean re-exports
- Keep server-only code in `server/` directory
- Use `server-only` package import for server-only modules
- Separate client and server utilities

### Code Quality

- Follow ESLint and Prettier configurations
- Use meaningful variable and function names
- Keep functions small and focused
- Avoid deep nesting - prefer early returns
- Write self-documenting code; add comments only when necessary
