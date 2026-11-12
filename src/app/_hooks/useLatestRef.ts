"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Returns a ref that always holds the latest `value`.
 *
 * Lets long-lived effects and callbacks (sockets, async init) read current
 * props/hook results without re-subscribing whenever they change. The ref is
 * updated in a layout effect, so it is current before any passive effect or
 * event handler runs, while keeping render itself free of ref writes.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
