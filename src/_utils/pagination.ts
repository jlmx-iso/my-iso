/**
 * Helpers for lists loaded a page at a time ("Load more"). The server's paged
 * procedures all answer `{ items, nextCursor }` (see
 * src/server/_db/pagination.ts).
 */
export type Page<T> = { items: T[]; nextCursor: string | null };

function withoutRepeats<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * The items of every loaded page, in the order the pages were loaded. An item
 * that shows up in two pages (the list changed between the two requests) is
 * kept once, where it first appeared.
 */
export function mergePages<T extends { id: string }>(pages: ReadonlyArray<Page<T>> | undefined): T[] {
  return withoutRepeats((pages ?? []).flatMap((page) => page.items));
}

/**
 * For lists read top to bottom, oldest first, where "load more" brings in
 * OLDER items (comments): each page is already oldest-first, and a page
 * loaded later goes above the ones loaded before it.
 */
export function mergePagesOldestFirst<T extends { id: string }>(
  pages: ReadonlyArray<Page<T>> | undefined,
): T[] {
  return withoutRepeats([...(pages ?? [])].reverse().flatMap((page) => page.items));
}

/** True when the last loaded page says there is another one. */
export function hasNextPage<T>(pages: ReadonlyArray<Page<T>> | undefined): boolean {
  return (pages?.at(-1)?.nextCursor ?? null) !== null;
}

/**
 * A count for a tab or heading that never claims to be the total while more
 * can be loaded: "12", or "20+" when there are more than the 20 loaded.
 */
export function loadedCountLabel(loaded: number, hasMore: boolean): string {
  return hasMore ? `${loaded}+` : String(loaded);
}

/**
 * "Showing 10 of 34 reviews" when only part of a known total is loaded, null
 * when everything is.
 */
export function partialCountNote(loaded: number, total: number, noun: { one: string; other: string }): string | null {
  if (loaded >= total) return null;
  return `Showing ${loaded} of ${total} ${total === 1 ? noun.one : noun.other}`;
}

/**
 * Offset-paged search (`search.searchAll`): each request asks for one row
 * more than the page size, so a list that comes back longer than the page
 * size has more to load.
 */
export function mergeOffsetPages<T extends { id: string }>(
  pages: ReadonlyArray<readonly T[] | undefined>,
  pageSize: number,
): { hasMore: boolean; items: T[] } {
  const loaded = pages.filter((page): page is readonly T[] => page !== undefined);
  return {
    hasMore: (loaded.at(-1)?.length ?? 0) > pageSize,
    items: withoutRepeats(loaded.flatMap((page) => page.slice(0, pageSize))),
  };
}
