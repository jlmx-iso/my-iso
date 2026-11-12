import { describe, expect, it } from "vitest";

import {
  hasNextPage,
  loadedCountLabel,
  mergeOffsetPages,
  mergePages,
  mergePagesOldestFirst,
  partialCountNote,
} from "./pagination";

const row = (id: string) => ({ id });
const ids = (rows: Array<{ id: string }>) => rows.map((item) => item.id);

describe("mergePages", () => {
  it("appends pages in the order they were loaded", () => {
    const pages = [
      { items: [row("a"), row("b")], nextCursor: "b" },
      { items: [row("c")], nextCursor: null },
    ];
    expect(ids(mergePages(pages))).toEqual(["a", "b", "c"]);
  });

  it("keeps a row that moved between pages once, where it first appeared", () => {
    const pages = [
      { items: [row("a"), row("b")], nextCursor: "b" },
      { items: [row("b"), row("c")], nextCursor: null },
    ];
    expect(ids(mergePages(pages))).toEqual(["a", "b", "c"]);
  });

  it("is empty before anything has loaded", () => {
    expect(mergePages(undefined)).toEqual([]);
    expect(mergePages([])).toEqual([]);
  });
});

describe("mergePagesOldestFirst", () => {
  it("puts each older page above the ones loaded before it", () => {
    // Comments 1..6; the first page holds the newest three, oldest first.
    const pages = [
      { items: [row("4"), row("5"), row("6")], nextCursor: "4" },
      { items: [row("1"), row("2"), row("3")], nextCursor: null },
    ];
    expect(ids(mergePagesOldestFirst(pages))).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("does not repeat a comment when a new one shifted the page boundary", () => {
    const pages = [
      { items: [row("5"), row("6"), row("7")], nextCursor: "5" },
      { items: [row("3"), row("4"), row("5")], nextCursor: null },
    ];
    expect(ids(mergePagesOldestFirst(pages))).toEqual(["3", "4", "5", "6", "7"]);
  });
});

describe("hasNextPage", () => {
  it("follows the cursor of the last loaded page", () => {
    expect(hasNextPage([{ items: [], nextCursor: "x" }])).toBe(true);
    expect(hasNextPage([{ items: [], nextCursor: "x" }, { items: [], nextCursor: null }])).toBe(false);
    expect(hasNextPage(undefined)).toBe(false);
  });
});

describe("loadedCountLabel", () => {
  it("never passes a partial count off as the total", () => {
    expect(loadedCountLabel(12, false)).toBe("12");
    expect(loadedCountLabel(20, true)).toBe("20+");
  });
});

describe("partialCountNote", () => {
  const noun = { one: "review", other: "reviews" };

  it("says how much of the total is showing", () => {
    expect(partialCountNote(10, 34, noun)).toBe("Showing 10 of 34 reviews");
  });

  it("says nothing when everything is loaded, or the total lags behind", () => {
    expect(partialCountNote(34, 34, noun)).toBeNull();
    expect(partialCountNote(35, 34, noun)).toBeNull();
  });
});

describe("mergeOffsetPages", () => {
  const page = (from: number, count: number) => Array.from({ length: count }, (_, i) => row(String(from + i)));

  it("drops the look-ahead row and reports that more exist", () => {
    const merged = mergeOffsetPages([page(0, 21)], 20);
    expect(merged.items).toHaveLength(20);
    expect(merged.hasMore).toBe(true);
  });

  it("knows the last page from its length", () => {
    const merged = mergeOffsetPages([page(0, 21), page(20, 7)], 20);
    expect(merged.items).toHaveLength(27);
    expect(ids(merged.items).at(-1)).toBe("26");
    expect(merged.hasMore).toBe(false);
  });

  it("ignores a page that is still loading, and repeats nothing", () => {
    const merged = mergeOffsetPages([page(0, 21), undefined], 20);
    expect(merged.items).toHaveLength(20);
    expect(merged.hasMore).toBe(true);
    expect(mergeOffsetPages([page(0, 3), page(2, 2)], 20).items).toHaveLength(4);
    expect(mergeOffsetPages([], 20)).toEqual({ hasMore: false, items: [] });
  });
});
