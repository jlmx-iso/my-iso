"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * A function that says whether the component is still mounted. For async
 * work that finishes after the user may have left (a dialog closed under a
 * request): its outcome then has to be reported some other way.
 */
export function useIsMounted(): () => boolean {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => mounted.current, []);
}
