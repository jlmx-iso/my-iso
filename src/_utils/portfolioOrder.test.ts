import { describe, expect, it } from "vitest";

import { canMoveImage, moveImage, sortPortfolio } from "./portfolioOrder";

const image = (id: string, sortOrder: number, isFeatured = false) => ({ id, isFeatured, sortOrder });

describe("sortPortfolio", () => {
  it("puts featured images first, then orders by sortOrder", () => {
    const sorted = sortPortfolio([image("a", 0), image("b", 1, true), image("c", 2), image("d", 3, true)]);
    expect(sorted.map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("keeps the given order for equal sortOrder and does not mutate its input", () => {
    const input = [image("a", 0), image("b", 0), image("c", 0)];
    expect(sortPortfolio(input).map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(input.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});

describe("moveImage", () => {
  const sorted = sortPortfolio([image("f1", 5, true), image("f2", 9, true), image("a", 1), image("b", 4)]);

  it("swaps with the neighbour and renumbers every image by position", () => {
    expect(moveImage(sorted, 3, "earlier")).toEqual([
      { id: "f1", sortOrder: 0 },
      { id: "f2", sortOrder: 1 },
      { id: "b", sortOrder: 2 },
      { id: "a", sortOrder: 3 },
    ]);
    expect(moveImage(sorted, 0, "later")?.map((i) => i.id)).toEqual(["f2", "f1", "a", "b"]);
  });

  it("refuses moves past either end", () => {
    expect(canMoveImage(sorted, 0, "earlier")).toBe(false);
    expect(canMoveImage(sorted, 3, "later")).toBe(false);
    expect(moveImage(sorted, 0, "earlier")).toBeNull();
  });

  it("refuses moves across the featured boundary, which would not change the display", () => {
    expect(canMoveImage(sorted, 1, "later")).toBe(false);
    expect(canMoveImage(sorted, 2, "earlier")).toBe(false);
    expect(moveImage(sorted, 2, "earlier")).toBeNull();
  });

  it("the result re-sorts to the order the user asked for", () => {
    const moved = moveImage(sorted, 2, "later")!;
    const byId = new Map(moved.map((m) => [m.id, m.sortOrder]));
    const resorted = sortPortfolio(sorted.map((i) => ({ ...i, sortOrder: byId.get(i.id)! })));
    expect(resorted.map((i) => i.id)).toEqual(["f1", "f2", "b", "a"]);
  });
});
