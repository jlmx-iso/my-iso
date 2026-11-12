/**
 * Cursor pagination, the same way everywhere: a query asks for one row more
 * than the page size (`take: limit + 1`), and `toPage` turns the rows into
 * the page and the cursor for the next one.
 *
 * `nextCursor` is the id of the last item of this page; passing it back as
 * `cursor` (Prisma `cursor: { id }, skip: 1`) continues right after it. It is
 * null when there is nothing more.
 */
export type Page<T> = { items: T[]; nextCursor: string | null };

export function toPage<T extends { id: string }>(rows: readonly T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
}

/**
 * Largest `offset` an offset-paginated list accepts. SQLite walks and
 * discards every skipped row, so an unbounded offset is an easy way to make
 * one request expensive.
 */
export const MAX_LIST_OFFSET = 10_000;
