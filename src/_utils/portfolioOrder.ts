/**
 * Display order of a portfolio: featured images first, then by `sortOrder`.
 * Reordering therefore only makes sense within the featured group or within
 * the rest; a move across that boundary would have no visible effect.
 */

export type OrderableImage = {
  id: string;
  isFeatured: boolean;
  sortOrder: number;
};

export type MoveDirection = "earlier" | "later";

/** Featured first, then ascending `sortOrder`; ties keep their given order. */
export function sortPortfolio<T extends OrderableImage>(images: readonly T[]): T[] {
  return images
    .map((image, index) => ({ image, index }))
    .sort(
      (a, b) =>
        Number(b.image.isFeatured) - Number(a.image.isFeatured) ||
        a.image.sortOrder - b.image.sortOrder ||
        a.index - b.index,
    )
    .map(({ image }) => image);
}

/** Whether the image at `index` of a sorted list can swap with its neighbour. */
export function canMoveImage(
  sorted: readonly OrderableImage[],
  index: number,
  direction: MoveDirection,
): boolean {
  const image = sorted[index];
  const neighbour = sorted[direction === "earlier" ? index - 1 : index + 1];
  return !!image && !!neighbour && image.isFeatured === neighbour.isFeatured;
}

/**
 * Swaps the image at `index` with its neighbour and returns the new
 * `sortOrder` of every image (its position in the list), or null when the
 * move is not possible.
 */
export function moveImage(
  sorted: readonly OrderableImage[],
  index: number,
  direction: MoveDirection,
): Array<{ id: string; sortOrder: number }> | null {
  if (!canMoveImage(sorted, index, direction)) return null;
  const target = direction === "earlier" ? index - 1 : index + 1;
  const next = [...sorted];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next.map((image, position) => ({ id: image.id, sortOrder: position }));
}
